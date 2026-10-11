use crate::descriptor::{capability_set, point_descriptor};
use crate::read::read_points;
use crate::{S7Config, S7Point};
use acquisition::{
    AcquisitionError, AcquisitionResult, DriverContext, EffectiveSubscription, ReadCapability,
    SessionCapabilities, SourceSession, SubscribeCapability, SubscriptionIntent, WriteCapability,
};
use async_trait::async_trait;
use flow::SourceId;
use points::{PointDescriptor, PointId, ReadRequest, ReadResult};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::{Mutex, watch};
use tokio_s7::client::S7Client;

/// tokio-s7's advertised PDU upper bound; the PLC may negotiate lower during
/// the setup exchange, in which case the negotiated value wins.
const DEFAULT_MAX_PDU_SIZE: u16 = 960;
/// Fixed PG connection role for the COTP connect request.
const CONNECTION_TYPE_PG: u8 = 0x01;
/// Header, parameter and per-item framing reserved from the negotiated PDU
/// when bounding one merged read window.
const READ_OVERHEAD_BYTES: u32 = 64;
/// Floor budget so very small PDUs can still read single points.
const MIN_READ_BYTES: u32 = 32;
/// Grace period for the background actor to finish a graceful disconnect.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

pub fn read_budget(pdu_length: u16) -> u32 {
    (u32::from(pdu_length).saturating_sub(READ_OVERHEAD_BYTES)).max(MIN_READ_BYTES)
}

pub fn descriptors(points: &[S7Point]) -> Vec<PointDescriptor> {
    points.iter().map(point_descriptor).collect()
}

pub struct Runtime {
    pub(crate) config: S7Config,
    pub(crate) points: HashMap<PointId, S7Point>,
    pub(crate) client: Mutex<Option<S7Client>>,
    pub(crate) max_read_bytes: AtomicU32,
    pub(crate) source_id: SourceId,
    pub(crate) sequence: AtomicU64,
    pub(crate) connection_epoch: AtomicU64,
    pub(crate) subscription: AtomicU64,
    pub(crate) execution: acquisition::ExecutionGate,
    pub(crate) state: parking_lot::RwLock<acquisition::SourceState>,
    pub(crate) closed: watch::Sender<bool>,
}

impl acquisition::session::SessionState for Runtime {
    fn state(&self) -> &parking_lot::RwLock<acquisition::SourceState> {
        &self.state
    }
    fn closed(&self) -> &watch::Sender<bool> {
        &self.closed
    }
    fn connection_epoch(&self) -> &AtomicU64 {
        &self.connection_epoch
    }
    fn sequence(&self) -> &AtomicU64 {
        &self.sequence
    }
}

impl acquisition::session::ConnectionSlot<S7Client> for Runtime {
    fn connection(&self) -> &Mutex<Option<S7Client>> {
        &self.client
    }
}

pub struct S7Session {
    runtime: Arc<Runtime>,
    capabilities: SessionCapabilities,
}

impl S7Session {
    pub(crate) async fn connect(
        config: S7Config,
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
            client: Mutex::new(None),
            max_read_bytes: AtomicU32::new(read_budget(DEFAULT_MAX_PDU_SIZE)),
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
                max_write_points: 100,
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
impl SourceSession for S7Session {
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
        acquisition::session::wait_closed(&*self.runtime).await
    }

    async fn close(&self) -> AcquisitionResult<()> {
        // actor 可能正滞留在未完成的请求中而无法立即处理优雅断开, 因此断开是
        // 尽力而为的后台任务, 最迟随 TCP 生命周期终止。
        acquisition::session::close_with(&*self.runtime, |mut client| async move {
            tokio::spawn(async move {
                let _ = tokio::time::timeout(CLOSE_TIMEOUT, client.disconnect()).await;
            });
            Ok(())
        })
        .await
    }
}

#[async_trait]
impl ReadCapability for S7Session {
    async fn read(&self, request: ReadRequest) -> AcquisitionResult<ReadResult> {
        read_points(&self.runtime, &request.points).await
    }
}

#[async_trait]
impl SubscribeCapability for S7Session {
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
                        // 只有停止中止轮询; 暂停状态下数据链继续 (暂停只停发送),
                        // 采集必须照常产出, 否则波形/录制会出现暂停缺口。
                        acquisition::AcquisitionRunState::Stopped => break,
                        acquisition::AcquisitionRunState::Running
                        | acquisition::AcquisitionRunState::Paused => {}
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
                        if runtime.execution.state() == acquisition::AcquisitionRunState::Stopped
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
impl WriteCapability for S7Session {
    async fn write(&self, request: points::WriteRequest) -> AcquisitionResult<points::WriteResult> {
        crate::write::write_request(&self.runtime, request).await
    }
}

pub use acquisition::operation::OperationError;

pub fn normalize<T>(
    result: Result<Result<T, tokio_s7::error::S7Error>, tokio::time::error::Elapsed>,
) -> Result<T, OperationError> {
    match result {
        Err(_) => Err(OperationError::new("timeout", "S7 request timed out", true)),
        Ok(Err(error)) => Err(OperationError::new(
            "transport",
            &error.to_string(),
            is_disconnect(&error),
        )),
        Ok(Ok(value)) => Ok(value),
    }
}

/// Whether an SDK error means the TCP session is unusable. Header-level
/// rejections ("Response error: ...") keep the session; a gone actor, socket
/// failure or ended/desynced byte stream requires reconnecting.
pub fn is_disconnect(error: &tokio_s7::error::S7Error) -> bool {
    use tokio_s7::error::S7Error;
    match error {
        S7Error::Error(message) if message.starts_with("Response error") => false,
        S7Error::Error(message) => {
            message.contains("Actor")
                || message.contains("Not connected")
                // framed.next() returning None: the peer closed the stream.
                || message.contains("No data in")
                || message.contains("Not a valid S7 data")
                || message.starts_with("Parse ")
        }
        other => {
            other.is_connection_error()
                || matches!(
                    other,
                    S7Error::IoErr(_) | S7Error::Timeout(_) | S7Error::PduParseError { .. }
                )
        }
    }
}

pub async fn ensure_connected(runtime: &Arc<Runtime>) -> AcquisitionResult<()> {
    let reconnect = runtime.config.reconnect.clone();
    acquisition::session::ensure_connected(
        runtime.as_ref(),
        &reconnect,
        || async {
            let (client, pdu_length) = connect_client(&runtime.config).await?;
            runtime
                .max_read_bytes
                .store(read_budget(pdu_length), Ordering::Release);
            Ok(client)
        },
        |_client: &S7Client| {},
    )
    .await
}

pub fn mark_degraded(runtime: &Runtime, detail: &str) {
    acquisition::session::mark_degraded(runtime, detail);
}

pub fn mark_online(runtime: &Runtime) {
    acquisition::session::mark_online(runtime);
}

/// Resolve the configured host and perform the tokio-s7 handshake. The SDK
/// parses `host:port` as a literal `SocketAddr`, so DNS resolution happens
/// here and only the resolved IP is handed over.
async fn connect_client(config: &S7Config) -> AcquisitionResult<(S7Client, u16)> {
    let timeout = Duration::from_millis(config.timeout_ms);
    let address = tokio::time::timeout(
        timeout,
        tokio::net::lookup_host((config.host.as_str(), config.port)),
    )
    .await
    .map_err(|_| AcquisitionError::Timeout)?
    .map_err(|error| AcquisitionError::Driver(error.to_string()))?
    .next()
    .ok_or_else(|| AcquisitionError::Driver("host resolved to no address".into()))?;
    let sdk_config = tokio_s7::client::S7Config {
        name: "lissio".into(),
        host: address.ip().to_string(),
        port: config.port,
        plc_type: config.plc_type.to_sdk(),
        connection_type: CONNECTION_TYPE_PG,
        rack: config.rack,
        slot: config.slot,
        timeout_ms: config.timeout_ms,
        max_pdu_size: DEFAULT_MAX_PDU_SIZE,
        // 重连节奏由适配器的指数退避与状态机统一控制, 不交给 SDK 的固定 2s 循环。
        auto_reconnect: false,
    };
    let mut client = S7Client::new(sdk_config);
    match tokio::time::timeout(timeout, client.connect()).await {
        Ok(Ok(())) => {
            let pdu_length = client.pdu_length;
            Ok((client, pdu_length))
        }
        Ok(Err(error)) => Err(AcquisitionError::Driver(error.to_string())),
        // 连接超时后 actor 可能仍滞留在握手中; 后台请求其优雅退出, 失败则随 TCP 生命周期终止。
        Err(_) => {
            tokio::spawn(async move {
                let _ = tokio::time::timeout(CLOSE_TIMEOUT, client.disconnect()).await;
            });
            Err(AcquisitionError::Timeout)
        }
    }
}
