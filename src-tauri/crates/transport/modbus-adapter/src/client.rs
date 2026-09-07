use crate::{
    decode_registers, encode_registers, plan_reads, ModbusArea, ModbusConfig, ModbusPoint,
    DRIVER_ID, SCHEMA_VERSION,
};
use acquisition::{
    AcquisitionError, AcquisitionResult, CapabilitySet, DriverContext, DriverId, DriverManifest,
    DriverPayload, DriverSchema, EffectiveSubscription, ReadCapability, SessionCapabilities,
    SourceFactory, SourceSession, SubscribeCapability, SubscriptionIntent, ValidatedConfig,
    WriteCapability,
};
use async_trait::async_trait;
use flow::{Direction, FlowEnvelope, PayloadKind, SourceId};
use points::{
    quality_flags, AccessLevel, DeliveryClass, NativeAddress, NativeStatus, PointBatch,
    PointDataType, PointDescriptor, PointId, PointQuality, PointSample, PointValue, ReadRequest,
    ReadResult, WriteItemResult, WriteRequest, WriteResult,
};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{watch, Mutex};
use tokio_modbus::client::{Context, Reader, Writer};
use tokio_modbus::Slave;

pub struct ModbusFactory {
    manifest: DriverManifest,
}

impl Default for ModbusFactory {
    fn default() -> Self {
        Self {
            manifest: DriverManifest {
                id: DriverId(DRIVER_ID.into()),
                display_name: "Modbus TCP client".into(),
                payload_kinds: BTreeSet::from([PayloadKind::Points]),
                capabilities: capability_set(),
            },
        }
    }
}

#[async_trait]
impl SourceFactory for ModbusFactory {
    fn manifest(&self) -> &DriverManifest {
        &self.manifest
    }

    fn config_schema(&self) -> DriverSchema {
        DriverSchema {
            schema_version: SCHEMA_VERSION,
            json_schema: schema(),
            ui_hints: serde_json::json!({"host": {"order": 0}, "port": {"order": 1}}),
        }
    }

    fn migrate(&self, input: DriverPayload) -> AcquisitionResult<DriverPayload> {
        if input.driver_id.0 != DRIVER_ID {
            return Err(AcquisitionError::DriverMismatch {
                expected: DRIVER_ID.into(),
                actual: input.driver_id.0,
            });
        }
        if input.schema_version != SCHEMA_VERSION {
            return Err(AcquisitionError::InvalidConfig(format!(
                "unsupported Modbus schema version {}",
                input.schema_version
            )));
        }
        Ok(input)
    }

    fn validate(&self, input: &DriverPayload) -> AcquisitionResult<ValidatedConfig> {
        if input.driver_id.0 != DRIVER_ID {
            return Err(AcquisitionError::DriverMismatch {
                expected: DRIVER_ID.into(),
                actual: input.driver_id.0.clone(),
            });
        }
        let config: ModbusConfig = serde_json::from_value(input.payload.clone())
            .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
        config
            .validate()
            .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
        Ok(ValidatedConfig::new(
            DriverId(DRIVER_ID.into()),
            move |context| {
                Box::pin(async move {
                    let session = ModbusSession::connect(config, context).await?;
                    Ok(Box::new(session) as Box<dyn SourceSession>)
                })
            },
        ))
    }
}

fn capability_set() -> CapabilitySet {
    CapabilitySet {
        read: true,
        subscribe: true,
        write: true,
        ..CapabilitySet::default()
    }
}

fn schema() -> serde_json::Value {
    serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["host", "points"],
        "properties": {
            "host": {"type": "string", "minLength": 1},
            "port": {"type": "integer", "minimum": 1, "maximum": 65535, "default": 502},
            "unitId": {"type": "integer", "minimum": 0, "maximum": 255, "default": 1},
            "timeoutMs": {"type": "integer", "minimum": 1, "default": 2000},
            "points": {"type": "array", "items": {"type": "object"}}
        }
    })
}

struct Runtime {
    config: ModbusConfig,
    points: HashMap<PointId, ModbusPoint>,
    context: Mutex<Option<Context>>,
    source_id: SourceId,
    sequence: AtomicU64,
    closed: watch::Sender<bool>,
}

pub struct ModbusSession {
    runtime: Arc<Runtime>,
    capabilities: SessionCapabilities,
    epoch: u64,
}

impl ModbusSession {
    async fn connect(
        config: ModbusConfig,
        driver_context: DriverContext,
    ) -> AcquisitionResult<Self> {
        let (closed, _) = watch::channel(false);
        let runtime = Arc::new(Runtime {
            points: config
                .points
                .iter()
                .cloned()
                .map(|point| (point.id.clone(), point))
                .collect(),
            context: Mutex::new(None),
            source_id: driver_context.source_id,
            sequence: AtomicU64::new(0),
            closed,
            config,
        });
        ensure_connected(&runtime).await?;
        Ok(Self {
            runtime,
            capabilities: SessionCapabilities {
                available: capability_set(),
                max_read_points: 2_000,
                max_write_points: 123,
                min_period_ms: Some(10),
                max_period_ms: None,
                source_timestamps: false,
                server_timestamps: false,
                idempotent_writes: false,
            },
            epoch: 1,
        })
    }

    pub fn descriptors(config: &ModbusConfig) -> Vec<PointDescriptor> {
        config.points.iter().map(descriptor).collect()
    }
}

#[async_trait]
impl SourceSession for ModbusSession {
    fn epoch(&self) -> u64 {
        self.epoch
    }
    fn capabilities(&self) -> &SessionCapabilities {
        &self.capabilities
    }
    fn reader(&self) -> Option<&dyn ReadCapability> {
        Some(self)
    }
    fn subscriber(&self) -> Option<&dyn SubscribeCapability> {
        Some(self)
    }
    fn writer(&self) -> Option<&dyn WriteCapability> {
        Some(self)
    }

    async fn stopped(&self) -> AcquisitionResult<()> {
        let mut closed = self.runtime.closed.subscribe();
        while !*closed.borrow() {
            closed
                .changed()
                .await
                .map_err(|_| AcquisitionError::Closed)?;
        }
        Ok(())
    }

    async fn close(&self) -> AcquisitionResult<()> {
        let _ = self.runtime.closed.send(true);
        // 先释放 context 锁再 await 断连, 避免 tokio MutexGuard 跨 await 点存活
        let context = self.runtime.context.lock().await.take();
        if let Some(mut context) = context {
            tokio_modbus::client::Client::disconnect(&mut context)
                .await
                .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
        }
        Ok(())
    }
}

#[async_trait]
impl ReadCapability for ModbusSession {
    async fn read(&self, request: ReadRequest) -> AcquisitionResult<ReadResult> {
        read_points(&self.runtime, &request.points, self.epoch).await
    }
}

#[async_trait]
impl SubscribeCapability for ModbusSession {
    async fn subscribe(
        &self,
        intent: SubscriptionIntent,
        sink: acquisition::SampleSink,
    ) -> AcquisitionResult<EffectiveSubscription> {
        let (accepted, rejected): (Vec<_>, Vec<_>) = intent
            .points
            .iter()
            .cloned()
            .partition(|point| self.runtime.points.contains_key(point));
        let rejected = rejected
            .into_iter()
            .map(|point_id| acquisition::PointRejection {
                point_id,
                reason: "unknown point".into(),
            })
            .collect();
        let period = intent
            .acquisition
            .requested_period_ms
            .unwrap_or_else(|| {
                accepted
                    .iter()
                    .filter_map(|id| {
                        self.runtime
                            .points
                            .get(id)
                            .map(|point| point.poll_period_ms)
                    })
                    .min()
                    .unwrap_or(1_000)
            })
            .max(10);
        if !accepted.is_empty() {
            let runtime = Arc::clone(&self.runtime);
            let points = accepted.clone();
            let epoch = self.epoch;
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(period));
                loop {
                    interval.tick().await;
                    if *runtime.closed.borrow() {
                        break;
                    }
                    if let Ok(result) = read_points(&runtime, &points, epoch).await {
                        if sink.send(result.batch).await.is_err() {
                            break;
                        }
                    }
                }
            });
        }
        Ok(EffectiveSubscription {
            accepted,
            rejected,
            effective_period_ms: Some(period),
            ordered: true,
            may_have_gaps: true,
        })
    }
}

#[async_trait]
impl WriteCapability for ModbusSession {
    async fn write(&self, request: WriteRequest) -> AcquisitionResult<WriteResult> {
        if request.deadline_unix_ns <= now_unix_ns() {
            return Err(AcquisitionError::Timeout);
        }
        let mut results = Vec::with_capacity(request.items.len());
        for item in request.items {
            let quality = match self.runtime.points.get(&item.point_id) {
                Some(point) if point.area.writable() => {
                    write_point(&self.runtime, point, &item.value).await
                }
                Some(_) => Err(OperationError::new(
                    "readOnly",
                    "Modbus area is read-only",
                    false,
                )),
                None => Err(OperationError::new(
                    "unknownPoint",
                    "point is not configured",
                    false,
                )),
            }
            .map_or_else(error_quality, |()| PointQuality::GOOD);
            results.push(WriteItemResult {
                point_id: item.point_id,
                quality,
            });
        }
        Ok(WriteResult {
            correlation_id: request.correlation_id,
            items: results,
        })
    }
}

async fn read_points(
    runtime: &Arc<Runtime>,
    requested: &[PointId],
    epoch: u64,
) -> AcquisitionResult<ReadResult> {
    let selected: Vec<&ModbusPoint> = requested
        .iter()
        .map(|id| {
            runtime
                .points
                .get(id)
                .ok_or_else(|| AcquisitionError::InvalidConfig(format!("unknown point: {}", id.0)))
        })
        .collect::<AcquisitionResult<_>>()?;
    let plans = plan_reads(selected.iter().copied())
        .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
    let mut samples = Vec::with_capacity(selected.len());
    for plan in plans {
        match read_plan(runtime, plan.area, plan.start, plan.quantity).await {
            Ok(ReadPayload::Bits(values)) => {
                for planned in plan.points {
                    let point = runtime
                        .points
                        .get(&planned.point_id)
                        .expect("validated read plan");
                    let value = values
                        .get(usize::from(planned.offset))
                        .copied()
                        .map(PointValue::Bool);
                    samples.push(sample(runtime, point, value, PointQuality::GOOD));
                }
            }
            Ok(ReadPayload::Registers(values)) => {
                for planned in plan.points {
                    let point = runtime
                        .points
                        .get(&planned.point_id)
                        .expect("validated read plan");
                    let registers = values
                        .get(usize::from(planned.offset)..)
                        .unwrap_or_default();
                    match decode_registers(point, registers) {
                        Ok(value) => {
                            samples.push(sample(runtime, point, Some(value), PointQuality::GOOD));
                        }
                        Err(error) => samples.push(sample(
                            runtime,
                            point,
                            None,
                            error_quality(OperationError::new("decode", &error.to_string(), false)),
                        )),
                    }
                }
            }
            Err(error) => {
                for planned in plan.points {
                    let point = runtime
                        .points
                        .get(&planned.point_id)
                        .expect("validated read plan");
                    samples.push(sample(runtime, point, None, error_quality(error.clone())));
                }
            }
        }
    }
    let by_id: HashMap<_, _> = samples
        .into_iter()
        .map(|sample| (sample.key.point_id.clone(), sample))
        .collect();
    let samples = requested
        .iter()
        .filter_map(|point_id| by_id.get(point_id).cloned())
        .collect();
    let sequence = runtime.sequence.fetch_add(1, Ordering::Relaxed);
    Ok(ReadResult {
        batch: FlowEnvelope {
            source_id: runtime.source_id.clone(),
            connection_epoch: epoch,
            first_sequence: sequence,
            last_sequence: sequence,
            observed_time_unix_ns: now_unix_ns(),
            direction: Direction::Receive,
            gap_before: None,
            payload: PointBatch {
                delivery: DeliveryClass::State,
                samples,
            },
        },
    })
}

enum ReadPayload {
    Bits(Vec<bool>),
    Registers(Vec<u16>),
}

#[derive(Clone)]
struct OperationError {
    code: String,
    detail: String,
    disconnect: bool,
}

impl OperationError {
    fn new(code: &str, detail: &str, disconnect: bool) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
            disconnect,
        }
    }
}

async fn read_plan(
    runtime: &Arc<Runtime>,
    area: ModbusArea,
    start: u16,
    quantity: u16,
) -> Result<ReadPayload, OperationError> {
    let mut attempt = 0_u32;
    loop {
        ensure_connected(runtime)
            .await
            .map_err(|error| OperationError::new("connect", &error.to_string(), true))?;
        let timeout = Duration::from_millis(runtime.config.timeout_ms);
        let result = {
            let mut guard = runtime.context.lock().await;
            let context = guard
                .as_mut()
                .ok_or_else(|| OperationError::new("closed", "connection unavailable", true))?;
            tokio::time::timeout(timeout, async {
                match area {
                    ModbusArea::Coils => context
                        .read_coils(start, quantity)
                        .await
                        .map(|inner| inner.map(ReadPayload::Bits)),
                    ModbusArea::DiscreteInputs => context
                        .read_discrete_inputs(start, quantity)
                        .await
                        .map(|inner| inner.map(ReadPayload::Bits)),
                    ModbusArea::InputRegisters => context
                        .read_input_registers(start, quantity)
                        .await
                        .map(|inner| inner.map(ReadPayload::Registers)),
                    ModbusArea::HoldingRegisters => context
                        .read_holding_registers(start, quantity)
                        .await
                        .map(|inner| inner.map(ReadPayload::Registers)),
                }
            })
            .await
        };
        match normalize(result) {
            Ok(value) => return Ok(value),
            Err(error) if !error.disconnect => return Err(error),
            Err(error) => {
                runtime.context.lock().await.take();
                if attempt >= runtime.config.reconnect.max_attempts {
                    return Err(error);
                }
                attempt = attempt.saturating_add(1);
                tokio::time::sleep(reconnect_delay(&runtime.config, attempt)).await;
            }
        }
    }
}

async fn write_point(
    runtime: &Arc<Runtime>,
    point: &ModbusPoint,
    value: &PointValue,
) -> Result<(), OperationError> {
    let coil = if point.area == ModbusArea::Coils {
        Some(match value {
            PointValue::Bool(value) => *value,
            _ => {
                return Err(OperationError::new(
                    "typeMismatch",
                    "coil writes require a bool",
                    false,
                ))
            }
        })
    } else {
        None
    };
    let words = if point.area == ModbusArea::HoldingRegisters {
        Some(
            encode_registers(point, value)
                .map_err(|error| OperationError::new("encode", &error.to_string(), false))?,
        )
    } else {
        None
    };
    ensure_connected(runtime)
        .await
        .map_err(|error| OperationError::new("connect", &error.to_string(), true))?;
    let timeout = Duration::from_millis(runtime.config.timeout_ms);
    let result = {
        let mut guard = runtime.context.lock().await;
        let context = guard
            .as_mut()
            .ok_or_else(|| OperationError::new("closed", "connection unavailable", true))?;
        tokio::time::timeout(timeout, async {
            match point.area {
                ModbusArea::Coils => {
                    context
                        .write_single_coil(point.address, coil.expect("validated coil"))
                        .await
                }
                ModbusArea::HoldingRegisters => {
                    let words = words.as_ref().expect("validated registers");
                    if words.len() == 1 {
                        context.write_single_register(point.address, words[0]).await
                    } else {
                        context
                            .write_multiple_registers(point.address, words.as_slice())
                            .await
                    }
                }
                ModbusArea::DiscreteInputs | ModbusArea::InputRegisters => {
                    unreachable!("writable checked before dispatch")
                }
            }
        })
        .await
    };
    normalize(result).inspect_err(|error| {
        if error.disconnect {
            let runtime = Arc::clone(runtime);
            tokio::spawn(async move {
                runtime.context.lock().await.take();
            });
        }
    })
}

fn normalize<T>(
    result: Result<tokio_modbus::Result<T>, tokio::time::error::Elapsed>,
) -> Result<T, OperationError> {
    match result {
        Err(_) => Err(OperationError::new(
            "timeout",
            "Modbus request timed out",
            true,
        )),
        Ok(Err(error)) => Err(OperationError::new("transport", &error.to_string(), true)),
        Ok(Ok(Err(exception))) => Err(OperationError::new(
            &format!("exception:{exception:?}"),
            &exception.to_string(),
            false,
        )),
        Ok(Ok(Ok(value))) => Ok(value),
    }
}

async fn ensure_connected(runtime: &Arc<Runtime>) -> AcquisitionResult<()> {
    if runtime.context.lock().await.is_some() {
        return Ok(());
    }
    let mut attempt = 0_u32;
    loop {
        match connect_context(&runtime.config).await {
            Ok(context) => {
                *runtime.context.lock().await = Some(context);
                return Ok(());
            }
            Err(error) if attempt >= runtime.config.reconnect.max_attempts => return Err(error),
            Err(_) => {
                attempt = attempt.saturating_add(1);
                tokio::time::sleep(reconnect_delay(&runtime.config, attempt)).await;
            }
        }
    }
}

async fn connect_context(config: &ModbusConfig) -> AcquisitionResult<Context> {
    let timeout = Duration::from_millis(config.timeout_ms);
    let mut addresses = tokio::time::timeout(
        timeout,
        tokio::net::lookup_host((config.host.as_str(), config.port)),
    )
    .await
    .map_err(|_| AcquisitionError::Timeout)?
    .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
    let address: SocketAddr = addresses
        .next()
        .ok_or_else(|| AcquisitionError::Driver("host resolved to no address".into()))?;
    tokio::time::timeout(
        timeout,
        tokio_modbus::client::tcp::connect_slave(address, Slave(config.unit_id)),
    )
    .await
    .map_err(|_| AcquisitionError::Timeout)?
    .map_err(|error| AcquisitionError::Driver(error.to_string()))
}

fn reconnect_delay(config: &ModbusConfig, attempt: u32) -> Duration {
    let factor = 1_u64
        .checked_shl(attempt.saturating_sub(1))
        .unwrap_or(u64::MAX);
    Duration::from_millis(
        config
            .reconnect
            .initial_delay_ms
            .saturating_mul(factor)
            .min(config.reconnect.max_delay_ms),
    )
}

fn sample(
    runtime: &Runtime,
    point: &ModbusPoint,
    value: Option<PointValue>,
    quality: PointQuality,
) -> PointSample {
    PointSample {
        key: points::PointKey {
            source_id: runtime.source_id.clone(),
            point_id: point.id.clone(),
        },
        value,
        quality,
        source_time_unix_ns: None,
        server_time_unix_ns: None,
        received_time_unix_ns: now_unix_ns(),
    }
}

fn error_quality(error: OperationError) -> PointQuality {
    let flags = if error.disconnect {
        quality_flags::COMM_FAILURE
    } else {
        0
    };
    PointQuality::bad(
        flags,
        NativeStatus {
            domain: "modbus".into(),
            code: error.code,
            detail: Some(error.detail),
        },
    )
}

fn descriptor(point: &ModbusPoint) -> PointDescriptor {
    let data_type = match point.data_type {
        crate::ModbusDataType::Bool => PointDataType::Bool,
        crate::ModbusDataType::U16 => PointDataType::U16,
        crate::ModbusDataType::I16 => PointDataType::I16,
        crate::ModbusDataType::U32 => PointDataType::U32,
        crate::ModbusDataType::I32 => PointDataType::I32,
        crate::ModbusDataType::U64 => PointDataType::U64,
        crate::ModbusDataType::I64 => PointDataType::I64,
        crate::ModbusDataType::F32 => PointDataType::F32,
        crate::ModbusDataType::F64 => PointDataType::F64,
    };
    PointDescriptor {
        id: point.id.clone(),
        path: vec![format!("{:?}", point.area)],
        name: point.id.0.clone(),
        data_type,
        access: if point.area.writable() {
            AccessLevel::ReadWrite
        } else {
            AccessLevel::ReadOnly
        },
        engineering_unit: None,
        semantic: BTreeMap::new(),
        native_address: NativeAddress {
            domain: "modbus".into(),
            value: serde_json::json!({"area": point.area, "address": point.address}),
        },
    }
}

fn now_unix_ns() -> i64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    i64::try_from(nanos).unwrap_or(i64::MAX)
}
