use crate::descriptor::{capability_set, point_descriptor};
use crate::read::{read_points, reconnect_delay};
use crate::{
    ModbusConfig, ModbusPoint, ModbusRtuConfig, ReconnectConfig, SerialDataBits, SerialFlowControl,
    SerialParity, SerialStopBits,
};
use acquisition::{
    AcquisitionError, AcquisitionResult, DriverContext, EffectiveSubscription, ReadCapability,
    SessionCapabilities, SourceSession, SubscribeCapability, SubscriptionIntent, WriteCapability,
};
use async_trait::async_trait;
use flow::SourceId;
use points::{PointDescriptor, PointId, ReadRequest, ReadResult};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{watch, Mutex};
use tokio_modbus::client::Context;
use tokio_modbus::Slave;
use tokio_serial::SerialPortBuilderExt;

#[derive(Clone)]
pub enum RuntimeConfig {
    Tcp(ModbusConfig),
    Rtu(ModbusRtuConfig),
}

impl RuntimeConfig {
    pub(crate) const fn timeout_ms(&self) -> u64 {
        match self {
            Self::Tcp(config) => config.timeout_ms,
            Self::Rtu(config) => config.timeout_ms,
        }
    }

    pub(crate) const fn reconnect(&self) -> &ReconnectConfig {
        match self {
            Self::Tcp(config) => &config.reconnect,
            Self::Rtu(config) => &config.reconnect,
        }
    }

    fn points(&self) -> &[ModbusPoint] {
        match self {
            Self::Tcp(config) => &config.points,
            Self::Rtu(config) => &config.points,
        }
    }
}

pub fn descriptors(points: &[ModbusPoint]) -> Vec<PointDescriptor> {
    points.iter().map(point_descriptor).collect()
}

pub struct Runtime {
    pub(crate) config: RuntimeConfig,
    pub(crate) points: HashMap<PointId, ModbusPoint>,
    pub(crate) context: Mutex<Option<Context>>,
    pub(crate) source_id: SourceId,
    pub(crate) sequence: AtomicU64,
    pub(crate) connection_epoch: AtomicU64,
    pub(crate) subscription: AtomicU64,
    pub(crate) execution: acquisition::ExecutionGate,
    pub(crate) state: parking_lot::RwLock<acquisition::SourceState>,
    pub(crate) closed: watch::Sender<bool>,
}

pub struct ModbusSession {
    runtime: Arc<Runtime>,
    capabilities: SessionCapabilities,
}

impl ModbusSession {
    pub(crate) async fn connect(
        config: RuntimeConfig,
        driver_context: DriverContext,
    ) -> AcquisitionResult<Self> {
        let (closed, _) = watch::channel(false);
        let runtime = Arc::new(Runtime {
            points: config
                .points()
                .iter()
                .cloned()
                .map(|point| (point.id.clone(), point))
                .collect(),
            context: Mutex::new(None),
            source_id: driver_context.source_id,
            sequence: AtomicU64::new(0),
            connection_epoch: AtomicU64::new(driver_context.connection_epoch.saturating_sub(1)),
            subscription: AtomicU64::new(0),
            execution: driver_context.execution,
            state: parking_lot::RwLock::new(acquisition::SourceState::Connecting),
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
        })
    }
}

#[async_trait]
impl SourceSession for ModbusSession {
    fn epoch(&self) -> u64 {
        self.runtime.connection_epoch.load(Ordering::Acquire)
    }
    fn capabilities(&self) -> &SessionCapabilities {
        &self.capabilities
    }
    fn state(&self) -> acquisition::SourceState {
        self.runtime.state.read().clone()
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
        *self.runtime.state.write() = acquisition::SourceState::Closing;
        let _ = self.runtime.closed.send(true);
        // 先释放 context 锁再 await 断连, 避免 tokio MutexGuard 跨 await 点存活
        let context = self.runtime.context.lock().await.take();
        if let Some(mut context) = context {
            tokio_modbus::client::Client::disconnect(&mut context)
                .await
                .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
        }
        *self.runtime.state.write() = acquisition::SourceState::Closed;
        Ok(())
    }
}

#[async_trait]
impl ReadCapability for ModbusSession {
    async fn read(&self, request: ReadRequest) -> AcquisitionResult<ReadResult> {
        read_points(&self.runtime, &request.points).await
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
            let generation = runtime
                .subscription
                .fetch_add(1, Ordering::AcqRel)
                .saturating_add(1);
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(period));
                let mut execution = runtime.execution.subscribe();
                loop {
                    if *runtime.closed.borrow()
                        || generation != runtime.subscription.load(Ordering::Acquire)
                    {
                        break;
                    }
                    let execution_state = *execution.borrow();
                    match execution_state {
                        acquisition::AcquisitionRunState::Stopped => break,
                        acquisition::AcquisitionRunState::Paused => {
                            if execution.changed().await.is_err() {
                                break;
                            }
                            continue;
                        }
                        acquisition::AcquisitionRunState::Running => {}
                    }
                    tokio::select! {
                        _ = interval.tick() => {}
                        changed = execution.changed() => {
                            if changed.is_err() { break; }
                            continue;
                        }
                    }
                    let execution_epoch = runtime.execution.epoch();
                    if let Ok(result) = read_points(&runtime, &points).await {
                        if runtime.execution.state() != acquisition::AcquisitionRunState::Running
                            || runtime.execution.epoch() != execution_epoch
                        {
                            continue;
                        }
                        tokio::select! {
                            changed = execution.changed() => {
                                if changed.is_err() { break; }
                            }
                            result = sink.send(result.batch) => {
                                if result.is_err() { break; }
                            }
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
    async fn write(&self, request: points::WriteRequest) -> AcquisitionResult<points::WriteResult> {
        crate::write::write_request(&self.runtime, request).await
    }
}

#[derive(Clone)]
pub struct OperationError {
    pub(crate) code: String,
    pub(crate) detail: String,
    pub(crate) disconnect: bool,
}

impl OperationError {
    pub(crate) fn new(code: &str, detail: &str, disconnect: bool) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
            disconnect,
        }
    }
}

pub fn normalize<T>(
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

pub async fn ensure_connected(runtime: &Arc<Runtime>) -> AcquisitionResult<()> {
    if *runtime.closed.borrow() {
        return Err(AcquisitionError::Closed);
    }
    if runtime.context.lock().await.is_some() {
        return Ok(());
    }
    let mut attempt = 0_u32;
    loop {
        *runtime.state.write() = acquisition::SourceState::Connecting;
        let mut closed = runtime.closed.subscribe();
        let connected = tokio::select! {
            _ = closed.changed() => return Err(AcquisitionError::Closed),
            result = connect_context(&runtime.config) => result,
        };
        match connected {
            Ok(context) => {
                *runtime.context.lock().await = Some(context);
                runtime.sequence.store(0, Ordering::Release);
                let epoch = runtime.connection_epoch.fetch_add(1, Ordering::AcqRel) + 1;
                *runtime.state.write() = acquisition::SourceState::Online {
                    connection_epoch: epoch,
                };
                return Ok(());
            }
            Err(error) if attempt >= runtime.config.reconnect().max_attempts => {
                mark_degraded(runtime, &error.to_string());
                return Err(error);
            }
            Err(error) => {
                mark_degraded(runtime, &error.to_string());
                attempt = attempt.saturating_add(1);
                *runtime.state.write() = acquisition::SourceState::Backoff { attempt };
                let mut closed = runtime.closed.subscribe();
                tokio::select! {
                    () = tokio::time::sleep(reconnect_delay(runtime.config.reconnect(), attempt)) => {}
                    _ = closed.changed() => return Err(AcquisitionError::Closed),
                }
            }
        }
    }
}

pub fn mark_degraded(runtime: &Runtime, detail: &str) {
    *runtime.state.write() = acquisition::SourceState::Degraded {
        detail: detail.into(),
    };
}

pub fn mark_online(runtime: &Runtime) {
    *runtime.state.write() = acquisition::SourceState::Online {
        connection_epoch: runtime.connection_epoch.load(Ordering::Acquire),
    };
}

async fn connect_context(config: &RuntimeConfig) -> AcquisitionResult<Context> {
    match config {
        RuntimeConfig::Tcp(config) => connect_tcp(config).await,
        RuntimeConfig::Rtu(config) => connect_rtu(config).await,
    }
}

async fn connect_tcp(config: &ModbusConfig) -> AcquisitionResult<Context> {
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

async fn connect_rtu(config: &ModbusRtuConfig) -> AcquisitionResult<Context> {
    let builder = tokio_serial::new(&config.port_name, config.baud_rate)
        .data_bits(match config.data_bits {
            SerialDataBits::Seven => tokio_serial::DataBits::Seven,
            SerialDataBits::Eight => tokio_serial::DataBits::Eight,
        })
        .parity(match config.parity {
            SerialParity::None => tokio_serial::Parity::None,
            SerialParity::Odd => tokio_serial::Parity::Odd,
            SerialParity::Even => tokio_serial::Parity::Even,
        })
        .stop_bits(match config.stop_bits {
            SerialStopBits::One => tokio_serial::StopBits::One,
            SerialStopBits::Two => tokio_serial::StopBits::Two,
        })
        .flow_control(match config.flow_control {
            SerialFlowControl::None => tokio_serial::FlowControl::None,
            SerialFlowControl::Software => tokio_serial::FlowControl::Software,
            SerialFlowControl::Hardware => tokio_serial::FlowControl::Hardware,
        });
    let serial = builder
        .open_native_async()
        .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
    Ok(tokio_modbus::client::rtu::attach_slave(
        serial,
        Slave(config.unit_id),
    ))
}

pub fn now_unix_ns() -> i64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    i64::try_from(nanos).unwrap_or(i64::MAX)
}
