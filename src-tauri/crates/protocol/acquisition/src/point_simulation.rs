use crate::{
    AcquisitionError, AcquisitionResult, AcquisitionRunState, CapabilitySet, DriverContext,
    EffectiveSubscription, ReadCapability, SampleSink, SessionCapabilities, SourceSession,
    SubscribeCapability, SubscriptionIntent,
};
use async_trait::async_trait;
use data_model::device::SimulationConfig;
use flow::{Direction, FlowEnvelope};
use points::{
    DeliveryClass, PointBatch, PointDataType, PointDescriptor, PointKey, PointQuality, PointSample,
    PointValue, ReadRequest, ReadResult,
};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::watch;

struct Simulation {
    config: watch::Sender<SimulationConfig>,
    cancel: watch::Sender<bool>,
    descriptors: Vec<PointDescriptor>,
    context: DriverContext,
    index: AtomicU64,
    subscription: AtomicU64,
    capabilities: SessionCapabilities,
}

pub fn open(
    descriptors: Vec<PointDescriptor>,
    config: SimulationConfig,
    context: DriverContext,
) -> AcquisitionResult<Box<dyn SourceSession>> {
    if descriptors.is_empty() {
        return Err(AcquisitionError::InvalidConfig(
            "configure simulation points first".into(),
        ));
    }
    let (config, _) = watch::channel(config);
    let (cancel, _) = watch::channel(false);
    let session = Arc::new(Simulation {
        config,
        cancel,
        descriptors,
        context,
        index: AtomicU64::new(0),
        subscription: AtomicU64::new(0),
        capabilities: SessionCapabilities {
            available: CapabilitySet {
                read: true,
                subscribe: true,
                ..Default::default()
            },
            max_read_points: 16_384,
            max_write_points: 0,
            min_period_ms: Some(1),
            max_period_ms: None,
            source_timestamps: true,
            server_timestamps: false,
            idempotent_writes: false,
        },
    });
    Ok(Box::new(SimulationSession(session)))
}

struct SimulationSession(Arc<Simulation>);

#[async_trait]
impl SourceSession for SimulationSession {
    fn epoch(&self) -> u64 {
        self.0.context.connection_epoch
    }
    fn capabilities(&self) -> &SessionCapabilities {
        &self.0.capabilities
    }
    fn reader(&self) -> Option<&dyn ReadCapability> {
        Some(self)
    }
    fn subscriber(&self) -> Option<&dyn SubscribeCapability> {
        Some(self)
    }
    fn update_simulation(&self, config: SimulationConfig) -> AcquisitionResult<()> {
        crate::simulation::validate(&config)?;
        self.0.config.send_replace(config);
        Ok(())
    }
    async fn stopped(&self) -> AcquisitionResult<()> {
        self.close().await
    }
    async fn close(&self) -> AcquisitionResult<()> {
        self.0.cancel.send_replace(true);
        Ok(())
    }
}

impl Drop for SimulationSession {
    fn drop(&mut self) {
        self.0.cancel.send_replace(true);
    }
}

impl Simulation {
    fn batch(&self, requested: &[points::PointId]) -> points::PointEnvelope {
        let config = self.config.borrow().clone();
        let index = self.index.fetch_add(1, Ordering::Relaxed);
        let timestamp =
            i64::try_from(data_model::now_us().saturating_mul(1000)).unwrap_or(i64::MAX);
        let samples = self
            .descriptors
            .iter()
            .filter(|point| requested.contains(&point.id))
            .map(|point| {
                let signal = config.overrides.get(&point.id.0).unwrap_or(&config.signal);
                let number = crate::simulation::sample(
                    signal,
                    config.seed,
                    index,
                    config.sample_rate,
                    &point.id.0,
                );
                let value = point_value(number, &point.data_type);
                PointSample {
                    key: PointKey {
                        source_id: self.context.source_id.clone(),
                        point_id: point.id.clone(),
                    },
                    quality: if value.is_some() {
                        PointQuality::GOOD
                    } else {
                        PointQuality {
                            validity: points::Validity::Bad,
                            flags: points::quality_flags::OUT_OF_RANGE,
                            native: None,
                        }
                    },
                    value,
                    source_time_unix_ns: Some(timestamp),
                    server_time_unix_ns: None,
                    received_time_unix_ns: timestamp,
                }
            })
            .collect();
        FlowEnvelope {
            source_id: self.context.source_id.clone(),
            connection_epoch: self.context.connection_epoch,
            first_sequence: index,
            last_sequence: index,
            observed_time_unix_ns: timestamp,
            direction: Direction::Receive,
            gap_before: None,
            payload: PointBatch {
                delivery: DeliveryClass::State,
                samples,
            },
        }
    }
}

#[async_trait]
impl ReadCapability for SimulationSession {
    async fn read(&self, request: ReadRequest) -> AcquisitionResult<ReadResult> {
        if *self.0.cancel.borrow() {
            return Err(AcquisitionError::Closed);
        }
        Ok(ReadResult {
            batch: self.0.batch(&request.points),
        })
    }
}

#[async_trait]
impl SubscribeCapability for SimulationSession {
    async fn subscribe(
        &self,
        intent: SubscriptionIntent,
        sink: SampleSink,
    ) -> AcquisitionResult<EffectiveSubscription> {
        let accepted: Vec<_> = intent
            .points
            .iter()
            .filter(|id| self.0.descriptors.iter().any(|p| &p.id == *id))
            .cloned()
            .collect();
        let rejected = intent
            .points
            .iter()
            .filter(|id| !accepted.contains(id))
            .cloned()
            .map(|point_id| crate::PointRejection {
                point_id,
                reason: "unknown point".into(),
            })
            .collect();
        if accepted.is_empty() {
            return Ok(EffectiveSubscription {
                accepted,
                rejected,
                effective_period_ms: None,
                ordered: true,
                may_have_gaps: false,
            });
        }
        let session = self.0.clone();
        let requested = accepted.clone();
        let generation = session
            .subscription
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1);
        let mut cancel = session.cancel.subscribe();
        let mut execution = session.context.execution.subscribe();
        tokio::spawn(async move {
            loop {
                if *cancel.borrow() || generation != session.subscription.load(Ordering::Acquire) {
                    break;
                }
                let period = std::time::Duration::from_secs_f64(
                    1.0 / f64::from(session.config.borrow().sample_rate),
                );
                tokio::select! { biased;
                    _ = cancel.changed() => break,
                    _ = execution.changed() => {},
                    () = tokio::time::sleep(period) => {
                        // 只有停止中止采样; 暂停期间数据链继续 (暂停只停发送)
                        if session.context.execution.state() == AcquisitionRunState::Stopped { continue; }
                        let epoch = session.context.execution.epoch();
                        let batch = session.batch(&requested);
                        if epoch != session.context.execution.epoch()
                            || generation != session.subscription.load(Ordering::Acquire) { continue; }
                        tokio::select! { biased;
                            _ = cancel.changed() => break,
                            _ = execution.changed() => {},
                            result = sink.send(batch) => { if result.is_err() { break; } }
                        }
                    }
                }
            }
        });
        Ok(EffectiveSubscription {
            accepted,
            rejected,
            effective_period_ms: Some(
                1000 / u64::from(self.0.config.borrow().sample_rate).min(1000),
            ),
            ordered: true,
            may_have_gaps: false,
        })
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss
)]
fn point_value(value: f64, data_type: &PointDataType) -> Option<PointValue> {
    if !value.is_finite() {
        return None;
    }
    Some(match data_type {
        PointDataType::Bool => PointValue::Bool(value > 0.0),
        PointDataType::I16 => PointValue::I64(
            value
                .round()
                .clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i64,
        ),
        PointDataType::U16 => PointValue::U64(value.round().clamp(0.0, f64::from(u16::MAX)) as u64),
        PointDataType::I32 => PointValue::I64(
            value
                .round()
                .clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i64,
        ),
        PointDataType::U32 => PointValue::U64(value.round().clamp(0.0, f64::from(u32::MAX)) as u64),
        PointDataType::I64 => PointValue::I64(value.round() as i64),
        PointDataType::U64 => PointValue::U64(value.round() as u64),
        PointDataType::F32 if (value as f32).is_finite() => {
            PointValue::F64(f64::from(value as f32))
        }
        PointDataType::F64 => PointValue::F64(value),
        _ => return None,
    })
}
