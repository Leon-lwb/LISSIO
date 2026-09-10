use crate::{
    AcquisitionError, AcquisitionResult, AcquisitionRunState, AdapterCapability,
    DiscoveredEndpoint, DriverContext, ExecutionGate, PointBatchObserver, SessionCapabilities,
    SourceRegistry, SourceSession, StateLane, SubscriptionIntent, validate_capability_contract,
};
use data_model::device::{DriverId, DriverPayload, EndpointId, EndpointSpec};
use flow::SourceId;
use points::{
    PointDescriptor, PointId, PointSample, ReadRequest, ReadResult, WriteRequest, WriteResult,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::mpsc;

const SAMPLE_CHANNEL_CAPACITY: usize = 256;
const SAMPLE_CACHE_POINTS: usize = 16_384;
const SAMPLE_CACHE_BYTES: usize = 16 * 1024 * 1024;

#[path = "runtime_bytes.rs"]
mod bytes;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum EndpointConnectionState {
    Connecting,
    Online { connection_epoch: u64 },
    Degraded { detail: String },
    Backoff { attempt: u32 },
    Closing,
    Closed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointSnapshot {
    pub id: EndpointId,
    pub label: String,
    pub adapter_id: DriverId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_endpoint_id: Option<String>,
    pub state: EndpointConnectionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<SessionCapabilities>,
    pub points: Vec<PointDescriptor>,
}

struct EndpointEntry {
    spec: EndpointSpec,
    state: parking_lot::RwLock<EndpointConnectionState>,
    session: Arc<dyn SourceSession>,
    points: Vec<PointDescriptor>,
    samples: Arc<StateLane>,
    sample_sink: mpsc::Sender<points::PointEnvelope>,
}

impl EndpointEntry {
    fn snapshot(&self) -> EndpointSnapshot {
        let state = match &*self.state.read() {
            EndpointConnectionState::Closing => EndpointConnectionState::Closing,
            EndpointConnectionState::Closed => EndpointConnectionState::Closed,
            _ => source_state(self.session.state()),
        };
        EndpointSnapshot {
            id: self.spec.id.clone(),
            label: self.spec.label.clone(),
            adapter_id: self.spec.driver.driver_id.clone(),
            capability_endpoint_id: self.spec.capability_endpoint_id.clone(),
            state,
            capabilities: Some(self.session.capabilities().clone()),
            points: self.points.clone(),
        }
    }
}

fn source_state(state: crate::SourceState) -> EndpointConnectionState {
    match state {
        crate::SourceState::Disabled | crate::SourceState::Closed => {
            EndpointConnectionState::Closed
        }
        crate::SourceState::Validating | crate::SourceState::Connecting => {
            EndpointConnectionState::Connecting
        }
        crate::SourceState::Online { connection_epoch } => {
            EndpointConnectionState::Online { connection_epoch }
        }
        crate::SourceState::Degraded { detail } => EndpointConnectionState::Degraded { detail },
        crate::SourceState::Backoff { attempt } => EndpointConnectionState::Backoff { attempt },
        crate::SourceState::Closing => EndpointConnectionState::Closing,
    }
}

/// Product-level owner for configured typed sources. Adapter I/O is never run
/// while the registry or endpoint map is locked.
pub struct AcquisitionRuntime {
    registry: Arc<SourceRegistry>,
    endpoints: parking_lot::RwLock<BTreeMap<EndpointId, Arc<EndpointEntry>>>,
    opening: parking_lot::Mutex<BTreeMap<EndpointId, OpeningSession>>,
    execution: ExecutionGate,
    observer: parking_lot::RwLock<Option<Arc<dyn PointBatchObserver>>>,
    epochs: parking_lot::Mutex<BTreeMap<EndpointId, u64>>,
}

impl AcquisitionRuntime {
    pub fn new(registry: Arc<SourceRegistry>) -> Self {
        Self {
            registry,
            endpoints: parking_lot::RwLock::new(BTreeMap::new()),
            opening: parking_lot::Mutex::new(BTreeMap::new()),
            execution: ExecutionGate::new(AcquisitionRunState::Stopped),
            observer: parking_lot::RwLock::new(None),
            epochs: parking_lot::Mutex::new(BTreeMap::new()),
        }
    }

    pub fn with_observer(
        registry: Arc<SourceRegistry>,
        observer: Arc<dyn PointBatchObserver>,
    ) -> Self {
        let runtime = Self::new(registry);
        *runtime.observer.write() = Some(observer);
        runtime
    }

    pub fn adapter_capabilities(&self) -> Vec<AdapterCapability> {
        self.registry.adapter_capabilities()
    }

    pub fn descriptors(&self, payload: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>> {
        self.factory(&payload.driver_id)?.point_descriptors(payload)
    }

    pub fn discover(&self, driver_id: &DriverId) -> AcquisitionResult<Vec<DiscoveredEndpoint>> {
        self.registry.discover(driver_id)
    }

    pub fn set_run_state(&self, state: AcquisitionRunState) -> u64 {
        self.execution.set(state)
    }

    pub fn validate(&self, payload: DriverPayload) -> AcquisitionResult<DriverPayload> {
        let factory = self.factory(&payload.driver_id)?;
        let _validated = factory.validate(&payload)?;
        let _points = factory.point_descriptors(&payload)?;
        Ok(payload)
    }

    pub async fn open_endpoint(&self, spec: EndpointSpec) -> AcquisitionResult<EndpointSnapshot> {
        validate_endpoint_spec(&spec)?;
        let canceled = Arc::new(AtomicBool::new(false));
        {
            let mut opening = self.opening.lock();
            if self.endpoints.read().contains_key(&spec.id) || opening.contains_key(&spec.id) {
                return Err(AcquisitionError::Busy);
            }
            opening.insert(
                spec.id.clone(),
                OpeningSession {
                    spec: spec.clone(),
                    canceled: canceled.clone(),
                },
            );
        }
        let reservation = OpeningReservation {
            ids: &self.opening,
            id: spec.id.clone(),
        };
        let factory = self.factory(&spec.driver.driver_id)?;
        let points = factory.point_descriptors(&spec.driver)?;
        let source_id = SourceId::new(spec.id.0.clone())
            .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
        let (sample_sink, mut sample_rx) = mpsc::channel(SAMPLE_CHANNEL_CAPACITY);
        let context = DriverContext {
            connection_epoch: {
                let mut epochs = self.epochs.lock();
                let epoch = epochs.entry(spec.id.clone()).or_default();
                *epoch = epoch.saturating_add(1);
                *epoch
            },
            source_id,
            state_sink: sample_sink.clone(),
            event_sink: sample_sink.clone(),
            execution: self.execution.clone(),
        };
        let session: Arc<dyn SourceSession> = if let Some(config) = &spec.simulation {
            factory.simulate(&spec.driver, config, context).await?
        } else {
            factory
                .open(factory.validate(&spec.driver)?, context)
                .await?
        }
        .into();
        if let Err(error) = validate_capability_contract(session.as_ref()) {
            let _ = session.close().await;
            return Err(error);
        }
        let samples = Arc::new(StateLane::new(SAMPLE_CACHE_POINTS, SAMPLE_CACHE_BYTES));
        let entry = Arc::new(EndpointEntry {
            spec,
            state: parking_lot::RwLock::new(EndpointConnectionState::Online {
                connection_epoch: session.epoch(),
            }),
            session,
            points,
            samples,
            sample_sink,
        });
        let weak = Arc::downgrade(&entry);
        let observer = self.observer.read().clone();
        let execution = self.execution.clone();
        tokio::spawn(async move {
            while let Some(envelope) = sample_rx.recv().await {
                let Some(entry) = weak.upgrade() else {
                    break;
                };
                let state = entry.state.read();
                if matches!(
                    *state,
                    EndpointConnectionState::Closing | EndpointConnectionState::Closed
                ) || envelope.connection_epoch != entry.session.epoch()
                    || execution.state() != AcquisitionRunState::Running
                {
                    continue;
                }
                if let Some(observer) = &observer {
                    observer.observe(&envelope);
                }
                for sample in envelope.payload.samples {
                    let _ = entry.samples.push(sample);
                }
            }
        });
        let snapshot = entry.snapshot();
        let installed = {
            let _opening = self.opening.lock();
            if canceled.load(Ordering::Acquire) {
                false
            } else {
                self.endpoints
                    .write()
                    .insert(snapshot.id.clone(), entry.clone());
                true
            }
        };
        if !installed {
            *entry.state.write() = EndpointConnectionState::Closing;
            let _ = entry.session.close().await;
            return Err(AcquisitionError::Closed);
        }
        drop(reservation);
        Ok(snapshot)
    }

    pub async fn close_endpoint(&self, endpoint_id: &EndpointId) -> AcquisitionResult<()> {
        let entry = {
            let opening = self.opening.lock();
            if let Some(pending) = opening.get(endpoint_id) {
                pending.canceled.store(true, Ordering::Release);
            }
            self.endpoints.write().remove(endpoint_id)
        };
        let Some(entry) = entry else {
            return Ok(());
        };
        *entry.state.write() = EndpointConnectionState::Closing;
        let result = entry.session.close().await;
        *entry.state.write() = EndpointConnectionState::Closed;
        result
    }

    /// Reconcile active sessions against the authoritative workspace devices.
    /// Restoring a configuration never opens a session.
    pub async fn reconcile(&self, specs: &[EndpointSpec]) -> Vec<String> {
        for pending in self.opening.lock().values() {
            if !specs.iter().any(|next| next == &pending.spec) {
                pending.canceled.store(true, Ordering::Release);
            }
        }
        let active: Vec<_> = self.endpoints.read().values().cloned().collect();
        let mut closed = Vec::new();
        for entry in active {
            let next = specs.iter().find(|s| s.id == entry.spec.id);
            let same_structure = next.is_some_and(|s| {
                s.driver == entry.spec.driver
                    && s.enabled == entry.spec.enabled
                    && s.capability_endpoint_id == entry.spec.capability_endpoint_id
                    && match (&s.simulation, &entry.spec.simulation) {
                        (None, None) => true,
                        (Some(a), Some(b)) => {
                            a.encoding == b.encoding
                                && a.channels == b.channels
                                && a.reference_node_id == b.reference_node_id
                        }
                        _ => false,
                    }
            });
            if same_structure {
                if let Some(config) = next.and_then(|s| s.simulation.as_ref()) {
                    if entry.session.update_simulation(config.clone()).is_ok() {
                        continue;
                    }
                } else {
                    continue;
                }
            }
            let id = entry.spec.id.clone();
            let _ = self.close_endpoint(&id).await;
            closed.push(id.0);
        }
        closed
    }

    pub fn snapshots(&self) -> Vec<EndpointSnapshot> {
        self.endpoints
            .read()
            .values()
            .map(|entry| entry.snapshot())
            .collect()
    }

    pub fn snapshot(&self, endpoint_id: &EndpointId) -> AcquisitionResult<EndpointSnapshot> {
        Ok(self.entry(endpoint_id)?.snapshot())
    }

    pub async fn read(
        &self,
        endpoint_id: &EndpointId,
        points: Vec<PointId>,
    ) -> AcquisitionResult<ReadResult> {
        let entry = self.entry(endpoint_id)?;
        let reader = entry
            .session
            .reader()
            .ok_or(AcquisitionError::Unsupported("read"))?;
        let result = reader.read(ReadRequest { points }).await?;
        let state = entry.state.read();
        if matches!(
            *state,
            EndpointConnectionState::Closing | EndpointConnectionState::Closed
        ) || result.batch.connection_epoch != entry.session.epoch()
        {
            return Err(AcquisitionError::Closed);
        }
        if let Some(observer) = &*self.observer.read() {
            observer.observe(&result.batch);
        }
        for sample in &result.batch.payload.samples {
            let _ = entry.samples.push(sample.clone());
        }
        Ok(result)
    }

    pub async fn subscribe(
        &self,
        endpoint_id: &EndpointId,
        intent: SubscriptionIntent,
    ) -> AcquisitionResult<crate::EffectiveSubscription> {
        let entry = self.entry(endpoint_id)?;
        entry
            .session
            .subscriber()
            .ok_or(AcquisitionError::Unsupported("subscribe"))?
            .subscribe(intent, entry.sample_sink.clone())
            .await
    }

    pub async fn write(
        &self,
        endpoint_id: &EndpointId,
        request: WriteRequest,
    ) -> AcquisitionResult<WriteResult> {
        let entry = self.entry(endpoint_id)?;
        entry
            .session
            .writer()
            .ok_or(AcquisitionError::Unsupported("write"))?
            .write(request)
            .await
    }

    pub fn latest_samples(&self, endpoint_id: &EndpointId) -> AcquisitionResult<Vec<PointSample>> {
        Ok(self.entry(endpoint_id)?.samples.snapshot())
    }

    fn factory(&self, driver_id: &DriverId) -> AcquisitionResult<Arc<dyn crate::SourceFactory>> {
        self.registry
            .factory(driver_id)
            .ok_or_else(|| AcquisitionError::UnknownDriver(driver_id.0.clone()))
    }

    fn entry(&self, endpoint_id: &EndpointId) -> AcquisitionResult<Arc<EndpointEntry>> {
        self.endpoints
            .read()
            .get(endpoint_id)
            .cloned()
            .ok_or_else(|| AcquisitionError::UnknownEndpoint(endpoint_id.0.clone()))
    }
}

struct OpeningSession {
    spec: EndpointSpec,
    canceled: Arc<AtomicBool>,
}

struct OpeningReservation<'a> {
    ids: &'a parking_lot::Mutex<BTreeMap<EndpointId, OpeningSession>>,
    id: EndpointId,
}

impl Drop for OpeningReservation<'_> {
    fn drop(&mut self) {
        self.ids.lock().remove(&self.id);
    }
}

fn validate_endpoint_spec(spec: &EndpointSpec) -> AcquisitionResult<()> {
    if spec.id.0.trim().is_empty() || spec.label.trim().is_empty() {
        return Err(AcquisitionError::InvalidConfig(
            "endpoint id and label must not be empty".into(),
        ));
    }
    if !spec.enabled {
        return Err(AcquisitionError::InvalidConfig(
            "disabled endpoint cannot be opened".into(),
        ));
    }
    Ok(())
}
