//! 字节设备 (串口/CAN 适配器) 的模拟源会话。
//!
//! 与 [`crate::test_data`] 共用同一份节拍契约
//! ([`data_model::simulation`]): 消息大小由 [`SimulationRate::samples_per_message`]
//! 决定, 节拍由**绝对截止时间**推进 —— 早期版本在 `select!` 里每轮新建
//! `sleep`, 周期变成「名义周期 + 处理耗时」, 实测帧率比标称低约 16%。
//!
//! 速率量纲由下游协议决定: 帧定界协议 ([`ProtocolConfig::is_frame_oriented`]) 下
//! `SimulationConfig::sample_rate` 是 CAN 帧率, 上限按
//! [`ProtocolConfig::max_simulation_rate`] 收窄 (见
//! [`acquisition::simulation::validate_for_protocol`])。

use acquisition::handle::TransportHandle;
use acquisition::{
    AcquisitionError, AcquisitionResult, AcquisitionRunState, ByteMessage, ConnectionControl,
    DriverContext, SessionCapabilities, SourceSession, TransportConnection,
};
use async_trait::async_trait;
use data_model::device::SimulationConfig;
use data_model::simulation::SimulationRate;
use data_model::{TestDataConfig, TestSignal, TransportConfig};
use schema_types::{ProtocolConfig, ProtocolSchema, SchemaPreset, encode_by_blocks};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, watch};

struct Control(watch::Sender<bool>);
impl ConnectionControl for Control {
    fn close(&self) {
        self.0.send_replace(true);
    }
}

/// 编码计划 — 设备文档声明的协议与其量纲校验结果。
///
/// 与配置一起装在 [`Generation`] 里经 `watch` 传递, 使生成循环每轮读到的是
/// **自洽的一对** (速率上限、协议) 而不是两个可能撕裂的字段。
#[derive(Clone)]
struct EncodingPlan {
    protocol: ProtocolConfig,
    schema: Option<ProtocolSchema>,
}

impl EncodingPlan {
    fn prepare(config: &SimulationConfig) -> AcquisitionResult<Self> {
        let encoding = config.encoding.as_ref().ok_or_else(|| {
            AcquisitionError::InvalidConfig(
                "select a simulation encoding or downstream parser".into(),
            )
        })?;
        let protocol: ProtocolConfig = serde_json::from_value(encoding["protocol"].clone())
            .map_err(|e| AcquisitionError::InvalidConfig(e.to_string()))?;
        let schema: Option<ProtocolSchema> = serde_json::from_value(encoding["schema"].clone())
            .map_err(|e| AcquisitionError::InvalidConfig(e.to_string()))?;
        if schema.as_ref().is_some_and(|s| {
            s.preset == SchemaPreset::Custom && s.encode.as_ref().is_none_or(Vec::is_empty)
        }) {
            return Err(AcquisitionError::InvalidConfig(
                "custom simulation requires encoding blocks".into(),
            ));
        }
        if matches!(protocol, ProtocolConfig::Diagnostic { .. }) {
            return Err(AcquisitionError::Unsupported("diagnostic simulation"));
        }
        // 速率校验按本协议的量纲 —— 帧定界协议的上限远低于采样率上限
        acquisition::simulation::validate_for_protocol(config, &protocol)?;
        Ok(Self { protocol, schema })
    }

    /// 本协议量纲下的速率 (已由 `prepare` 校验, 故此处只会是同一上限内的值)。
    fn rate(&self, config: &SimulationConfig) -> AcquisitionResult<SimulationRate> {
        SimulationRate::new(config.sample_rate, self.protocol.max_simulation_rate())
            .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))
    }
}

/// 生成循环每轮读取的一代配置 (速率与协议必须成对, 不可分裂).
#[derive(Clone)]
struct Generation {
    config: SimulationConfig,
    plan: EncodingPlan,
    rate: SimulationRate,
}

struct Session {
    handle: TransportHandle,
    generation: watch::Sender<Generation>,
    epoch: u64,
    capabilities: SessionCapabilities,
}

#[async_trait]
impl SourceSession for Session {
    fn epoch(&self) -> u64 {
        self.epoch
    }
    fn capabilities(&self) -> &SessionCapabilities {
        &self.capabilities
    }
    fn byte_stream(&self) -> Option<&TransportHandle> {
        Some(&self.handle)
    }
    fn update_simulation(&self, config: SimulationConfig) -> AcquisitionResult<()> {
        // 编码可能随配置一起变更 (换参考解析器即换协议), 校验必须按新编码的量纲重做
        let plan = EncodingPlan::prepare(&config)?;
        let rate = plan.rate(&config)?;
        self.handle.set_sample_rate(config.sample_rate);
        self.generation
            .send_replace(Generation { config, plan, rate });
        Ok(())
    }
    async fn stopped(&self) -> AcquisitionResult<()> {
        self.handle.wait_closed().await;
        Ok(())
    }
    async fn close(&self) -> AcquisitionResult<()> {
        self.handle.close();
        Ok(())
    }
}

pub fn open(
    config: SimulationConfig,
    context: DriverContext,
) -> AcquisitionResult<Box<dyn SourceSession>> {
    let plan = EncodingPlan::prepare(&config)?;
    let rate = plan.rate(&config)?;
    let live_config = TransportConfig::TestData(TestDataConfig {
        channels: config.channels as usize,
        #[allow(clippy::cast_precision_loss)] // Simulation rates are validated to at most 5 MHz.
        sample_rate: config.sample_rate as f32,
        signal: TestSignal::Sine,
    });
    let (generation, mut generation_rx) = watch::channel(Generation { config, plan, rate });
    let (cancel, mut cancel_rx) = watch::channel(false);
    let (data, _) = broadcast::channel(data_model::INGEST_CHANNEL_CAPACITY);
    // 写入面必须保留接收端: 接收端被丢弃时 `TransportHandle::send` 恒返回 Closed,
    // 该会话将永远无法被写入。此处与 `test_data::spawn` 同构 —— 生成任务持接收端
    // 并逐轮排空 (回环本身由 `TransportHandle::send` 完成)。
    let (write, mut write_rx) = mpsc::channel(1);
    let handle = TransportHandle::new(
        TransportConnection::new(write, data.clone(), Arc::new(Control(cancel))),
        live_config,
        context.connection_epoch,
    );
    let connection_epoch = context.connection_epoch;
    let source_id = context.source_id.as_str().to_string();
    tokio::spawn(async move {
        let mut index = 0_u64;
        let mut generated_messages = 0_u64;
        let mut generated_bytes = 0_u64;
        let mut skipped_without_receiver = 0_u64;
        let mut write_messages = 0_u64;
        let mut last_message_len = 0_usize;
        let mut last_progress = std::time::Instant::now();
        let exit_reason: &str;
        let mut current = generation_rx.borrow_and_update().clone();
        let mut interval = current.rate.message_interval();
        log::info!(
            "模拟字节源任务启动: source={source_id}, epoch={connection_epoch}, rate={}/s, message_interval={interval:?}",
            current.rate.get()
        );
        // 绝对截止时间: 迟到批次逐轮补齐, 调度抖动不改变名义速率
        let mut next_deadline = tokio::time::Instant::now() + interval;
        loop {
            tokio::select! { biased;
                _ = cancel_rx.changed() => {
                    exit_reason = "cancelled";
                    break;
                }
                result = generation_rx.changed() => {
                    if result.is_err() {
                        exit_reason = "generation_closed";
                        break;
                    }
                    current = generation_rx.borrow_and_update().clone();
                    interval = current.rate.message_interval();
                    next_deadline = tokio::time::Instant::now() + interval;
                }
                () = tokio::time::sleep_until(next_deadline) => {
                    next_deadline += interval;
                    // 只有停止中止生成; 暂停期间数据链继续 (暂停只停发送),
                    // 模拟源必须照常产字节, 否则缓存/录制出现暂停缺口。
                    if context.execution.state() == AcquisitionRunState::Stopped {
                        continue;
                    }
                    if data.receiver_count() == 0 {
                        skipped_without_receiver += 1;
                        continue;
                    }
                    let epoch = context.execution.epoch();
                    let count = current.rate.samples_per_message();
                    let mut bytes = Vec::new();
                    for _ in 0..count {
                        bytes.extend(encode(&current, index));
                        index = index.saturating_add(1);
                    }
                    // 快照期间可能被关闭/换代: 只有状态与 epoch 都未变才投递。
                    // 无接收者 = 数据平面未挂载读任务 —— 显式记录丢弃量, 不静默吞掉。
                    generated_messages += 1;
                    last_message_len = bytes.len();
                    generated_bytes = generated_bytes.saturating_add(bytes.len() as u64);
                    if last_progress.elapsed() >= std::time::Duration::from_secs(1) {
                        log::info!(
                            "模拟字节源进度: source={source_id}, messages={generated_messages}, bytes={generated_bytes}, last_message_len={last_message_len}, skipped_without_receiver={skipped_without_receiver}"
                        );
                        last_progress = std::time::Instant::now();
                    }
                    if context.execution.epoch() == epoch
                        && context.execution.state() != AcquisitionRunState::Stopped
                        && let Err(error) = data.send(ByteMessage::from_device(bytes))
                    {
                        log::debug!(
                            "模拟字节无接收者, 丢弃一批 ({} 字节)",
                            error.0.bytes.len()
                        );
                    }
                }
                written = write_rx.recv() => {
                    if written.is_none() {
                        exit_reason = "write_closed";
                        break;
                    }
                    write_messages += 1;
                }
            }
        }
        log::info!(
            "模拟字节源任务退出: source={source_id}, reason={exit_reason}, messages={generated_messages}, bytes={generated_bytes}, last_message_len={last_message_len}, skipped_without_receiver={skipped_without_receiver}, writes={write_messages}"
        );
    });
    Ok(Box::new(Session {
        handle,
        generation,
        epoch: connection_epoch,
        capabilities: SessionCapabilities {
            available: acquisition::CapabilitySet {
                byte_source: true,
                ..Default::default()
            },
            max_read_points: 0,
            max_write_points: 0,
            min_period_ms: None,
            max_period_ms: None,
            source_timestamps: false,
            server_timestamps: false,
            idempotent_writes: false,
        },
    }))
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn encode(generation: &Generation, index: u64) -> Vec<u8> {
    let Generation {
        config,
        plan,
        rate: _,
    } = generation;
    let names = plan
        .schema
        .as_ref()
        .filter(|s| s.preset == SchemaPreset::Custom)
        .map_or_else(
            || (0..config.channels).map(|i| format!("ch{i}")).collect(),
            ProtocolSchema::port_names,
        );
    let values: Vec<f32> = names
        .iter()
        .map(|name| {
            acquisition::simulation::sample(
                config.overrides.get(name).unwrap_or(&config.signal),
                config.seed,
                index,
                config.sample_rate,
                name,
            ) as f32
        })
        .collect();
    if let Some(blocks) = plan
        .schema
        .as_ref()
        .filter(|s| s.preset == SchemaPreset::Custom)
        .and_then(|s| s.encode.as_ref())
    {
        return encode_by_blocks(blocks, &names, &values);
    }
    match &plan.protocol {
        ProtocolConfig::JustFloat { .. } => values
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .chain([0, 0, 128, 127])
            .collect(),
        ProtocolConfig::FireWater { .. } => format!(
            "{}\n",
            values
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(",")
        )
        .into_bytes(),
        ProtocolConfig::RawData => values.iter().map(|v| v.clamp(0.0, 255.0) as u8).collect(),
        ProtocolConfig::Slcan => {
            use std::fmt::Write as _;
            let payload = (0..8).fold(String::with_capacity(16), |mut output, i| {
                let byte = values.get(i).copied().unwrap_or(0.0).clamp(0.0, 255.0) as u8;
                write!(output, "{byte:02X}").expect("writing to String cannot fail");
                output
            });
            format!("t{:03X}8{payload}\r", index % 0x800).into_bytes()
        }
        ProtocolConfig::CandleLight => {
            let mut packet = vec![0_u8; 24];
            packet[0] = 0x11;
            packet[8..12].copy_from_slice(&((index % 0x800) as u32).to_le_bytes());
            packet[12] = 8;
            for i in 0..8 {
                packet[16 + i] = values.get(i).copied().unwrap_or(0.0).clamp(0.0, 255.0) as u8;
            }
            packet
        }
        ProtocolConfig::LogicDecode { .. } => vec![
            values
                .iter()
                .take(8)
                .enumerate()
                .fold(0, |bits, (i, v)| bits | (u8::from(*v > 0.0) << i)),
        ],
        ProtocolConfig::Diagnostic { .. } => unreachable!("validated at open"),
    }
}
