use acquisition::handle::TransportHandle;
use acquisition::{
    AcquisitionError, AcquisitionResult, AcquisitionRunState, ByteMessage, ConnectionControl,
    DriverContext, SessionCapabilities, SourceSession, TransportConnection,
};
use async_trait::async_trait;
use data_model::device::SimulationConfig;
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

struct Session {
    handle: TransportHandle,
    config: watch::Sender<SimulationConfig>,
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
        acquisition::simulation::validate(&config)?;
        self.handle.set_sample_rate(config.sample_rate);
        self.config.send_replace(config);
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
    acquisition::simulation::validate(&config)?;
    let encoding = config.encoding.as_ref().ok_or_else(|| {
        AcquisitionError::InvalidConfig("select a simulation encoding or downstream parser".into())
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
    let live_config = TransportConfig::TestData(TestDataConfig {
        channels: config.channels as usize,
        #[allow(clippy::cast_precision_loss)] // Simulation rates are validated to at most 5 MHz.
        sample_rate: config.sample_rate as f32,
        signal: TestSignal::Sine,
    });
    let (updates, mut update_rx) = watch::channel(config);
    let (cancel, mut cancel_rx) = watch::channel(false);
    let (data, _) = broadcast::channel(data_model::INGEST_CHANNEL_CAPACITY);
    let (write, _writes) = mpsc::channel(1);
    let handle = TransportHandle::new(
        TransportConnection::new(write, data.clone(), Arc::new(Control(cancel))),
        live_config,
        context.connection_epoch,
    );
    let connection_epoch = context.connection_epoch;
    tokio::spawn(async move {
        let mut index = 0_u64;
        let mut config = update_rx.borrow_and_update().clone();
        loop {
            tokio::select! { biased;
                _ = cancel_rx.changed() => break,
                result = update_rx.changed() => {
                    if result.is_err() { break; }
                    config = update_rx.borrow_and_update().clone();
                }
                () = tokio::time::sleep(std::time::Duration::from_secs_f64(f64::from((config.sample_rate / 200).max(1)) / f64::from(config.sample_rate))) => {
                    if context.execution.state() != AcquisitionRunState::Running || data.receiver_count() == 0 { continue; }
                    let epoch = context.execution.epoch();
                    let count = (config.sample_rate / 200).max(1);
                    let mut bytes = Vec::new();
                    for _ in 0..count {
                        bytes.extend(encode(&config, &protocol, schema.as_ref(), index));
                        index = index.saturating_add(1);
                    }
                    if context.execution.epoch() == epoch && context.execution.state() == AcquisitionRunState::Running {
                        let _ = data.send(ByteMessage::from_device(bytes));
                    }
                }
            }
        }
    });
    Ok(Box::new(Session {
        handle,
        config: updates,
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
fn encode(
    config: &SimulationConfig,
    protocol: &ProtocolConfig,
    schema: Option<&ProtocolSchema>,
    index: u64,
) -> Vec<u8> {
    let names = schema
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
    if let Some(blocks) = schema
        .filter(|s| s.preset == SchemaPreset::Custom)
        .and_then(|s| s.encode.as_ref())
    {
        return encode_by_blocks(blocks, &names, &values);
    }
    match protocol {
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
