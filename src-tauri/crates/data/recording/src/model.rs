use serde::{Deserialize, Serialize};

use crate::RecordingError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Domain {
    Bytes,
    String,
    Float,
    Spectrum,
}

impl Domain {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bytes => "bytes",
            Self::String => "string",
            Self::Float => "float",
            Self::Spectrum => "spectrum",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PortIdentity {
    pub source_node_id: String,
    pub source_handle: String,
}

impl PortIdentity {
    #[must_use]
    pub fn new(source_node_id: impl Into<String>, source_handle: impl Into<String>) -> Self {
        Self {
            source_node_id: source_node_id.into(),
            source_handle: source_handle.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindingCapability {
    Scalar,
    Text,
    Records,
    Curve,
    Raw,
}

impl BindingCapability {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Scalar => "scalar",
            Self::Text => "text",
            Self::Records => "records",
            Self::Curve => "curve",
            Self::Raw => "raw",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayBinding {
    pub id: String,
    pub component_id: String,
    pub port: PortIdentity,
    pub domain: Domain,
    pub capability: BindingCapability,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "domain", rename_all = "snake_case")]
pub enum BatchPayload {
    Bytes {
        data: Vec<u8>,
    },
    String {
        values: Vec<String>,
    },
    Float {
        values: Vec<f64>,
    },
    Spectrum {
        frequencies: Vec<f64>,
        values: Vec<f64>,
    },
}

impl BatchPayload {
    #[must_use]
    pub const fn domain(&self) -> Domain {
        match self {
            Self::Bytes { .. } => Domain::Bytes,
            Self::String { .. } => Domain::String,
            Self::Float { .. } => Domain::Float,
            Self::Spectrum { .. } => Domain::Spectrum,
        }
    }

    #[must_use]
    pub const fn item_count(&self) -> usize {
        match self {
            Self::Bytes { data } => data.len(),
            Self::String { values } => values.len(),
            Self::Float { values } => values.len(),
            Self::Spectrum { values, .. } => values.len(),
        }
    }

    #[must_use]
    pub fn effective_bytes(&self) -> usize {
        match self {
            Self::Bytes { data } => data.len(),
            Self::String { values } => values.iter().map(String::len).sum(),
            Self::Float { values } => values.len().saturating_mul(size_of::<f64>()),
            Self::Spectrum {
                frequencies,
                values,
            } => frequencies
                .len()
                .saturating_add(values.len())
                .saturating_mul(size_of::<f64>()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordBatch {
    pub binding_id: String,
    pub epoch: u64,
    pub sequence_start: u64,
    pub timestamps_us: Vec<u64>,
    pub payload: BatchPayload,
}

impl RecordBatch {
    #[must_use]
    pub fn sequence_end(&self) -> u64 {
        self.sequence_start
            .saturating_add(u64::try_from(self.payload.item_count()).unwrap_or(u64::MAX))
            .saturating_sub(1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Running,
    Paused,
    Stopped,
    Failed,
}

impl SessionState {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Stopped => "stopped",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub started_at_us: u64,
    pub ended_at_us: Option<u64>,
    pub state: SessionState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingLimits {
    pub queue_batches: usize,
    pub transaction_bytes: usize,
    pub commit_interval_ms: u64,
}

impl Default for RecordingLimits {
    fn default() -> Self {
        Self {
            // 缓冲必须扛得住一次 checkpoint / 杀毒扫描停顿。256 条只够不到一秒
            // 的突发, Windows 上必然打满, 而打满曾被误判成写入故障 (见
            // `hub::fault`) — 一次瞬态背压就会把采集永久停住。
            queue_batches: 4_096,
            transaction_bytes: 8 * 1024 * 1024,
            commit_interval_ms: 250,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingHealth {
    pub accepted_batches: u64,
    pub accepted_bytes: u64,
    pub persisted_batches: u64,
    pub persisted_bytes: u64,
    pub accepted_sequence: u64,
    pub persisted_sequence: u64,
    pub queued_batches: u64,
    /// 数据库写入总开关 (设置项)。`false` 是用户主动关闭, 不是故障。
    pub enabled: bool,
    /// 写线程队列打满而丢弃的批次数 — 正常背压, 采集与运行控制不受影响。
    /// 大于零表示磁盘/checkpoint 一时跟不上, 该区间的录制数据不完整。
    pub dropped_batches: u64,
    /// 绑定缺失或域不匹配而被拒的批次数 — 图编辑与在途批次的竞态, 同样不影响采集。
    pub rejected_batches: u64,
    /// 可见但**非故障**的提示 (例如打开时自动重建过数据库)。
    ///
    /// 与 `failed` 严格分开: `failed` 会被 [`crate::RecordingHub::fault`] 当成
    /// 录制契约破坏而停掉采集, 提示不行。
    pub warning: Option<String>,
    pub failed: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredBatch {
    pub row_id: i64,
    pub session_id: String,
    pub binding_id: String,
    pub domain: Domain,
    pub epoch: u64,
    pub sequence_start: u64,
    pub sequence_end: u64,
    pub first_timestamp_us: u64,
    pub last_timestamp_us: u64,
    pub item_count: u64,
    pub effective_bytes: u64,
    pub checksum: u64,
    pub payload: Option<BatchPayload>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BindingInfo {
    pub id: String,
    pub session_id: String,
    pub component_id: String,
    pub source_node_id: String,
    pub source_handle: String,
    pub domain: Domain,
    pub capability: BindingCapability,
    pub bound_at_us: u64,
    pub unbound_at_us: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionSummary {
    pub session: SessionInfo,
    pub binding_count: u64,
    pub batch_count: u64,
    pub item_count: u64,
    pub effective_bytes: u64,
    pub first_timestamp_us: Option<u64>,
    pub last_timestamp_us: Option<u64>,
    /// Whether the hub is currently writing into this session.
    #[serde(default)]
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingDatabaseInfo {
    pub path: String,
    pub file_size_bytes: u64,
    pub session_count: u64,
    pub batch_count: u64,
    pub item_count: u64,
    pub effective_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingExportFormat {
    Csv,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingExportRequest {
    pub session_id: String,
    pub binding_id: Option<String>,
    pub from_us: Option<u64>,
    pub to_us: Option<u64>,
    pub format: RecordingExportFormat,
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingExportResult {
    pub rows: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingCleanupPolicy {
    #[serde(default)]
    pub session_ids: Vec<String>,
    #[serde(default)]
    pub delete_stopped: bool,
    #[serde(default)]
    pub delete_failed: bool,
    #[serde(default)]
    pub older_than_us: Option<u64>,
    #[serde(default)]
    pub keep_latest: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingCleanupResult {
    pub deleted_sessions: u64,
    pub deleted_batches: u64,
    pub deleted_items: u64,
    pub deleted_bytes: u64,
    /// Non-fatal problems: sessions that survived cleanup, or an automatic database repair.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryQuery {
    pub session_id: String,
    pub binding_id: Option<String>,
    pub after_row_id: i64,
    pub from_us: Option<u64>,
    pub to_us: Option<u64>,
    pub limit: usize,
    pub include_payload: bool,
}

/// 写入前的批次校验 — 空批次与「时间戳数量 / 载荷列数」不一致都会破坏录制契约。
///
/// 由唯一连接上的写入路径 ([`crate::store::RecordingStore::write_batch`]) 调用,
/// 所以放这里而不是散在 store 里: 校验的是模型自身的合法性。
pub fn validate_batch(batch: &RecordBatch) -> Result<(), RecordingError> {
    let count = batch.payload.item_count();
    if count == 0 {
        return Err(RecordingError::Invalid("empty recording batch".into()));
    }
    let valid_timestamps = match &batch.payload {
        BatchPayload::Bytes { .. } | BatchPayload::Spectrum { .. } => {
            batch.timestamps_us.len() == 1
        }
        BatchPayload::String { .. } | BatchPayload::Float { .. } => {
            batch.timestamps_us.len() == count
        }
    };
    if !valid_timestamps {
        return Err(RecordingError::Invalid(
            "timestamp and payload column lengths differ".into(),
        ));
    }
    Ok(())
}
