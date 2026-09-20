//! Byte capability access on the same endpoint registry as point sessions.
use super::{AcquisitionRuntime, EndpointConnectionState, EndpointEntry};
use crate::{PointBatchObserver, SourceRegistry};
use data_model::device::EndpointId;
use data_model::{ConnectionState, TransportConfig, TransportStats};
use flow::SourceId;
use schema_types::TestDataLink;
use std::sync::Arc;
use tokio::sync::broadcast;

impl Default for AcquisitionRuntime {
    fn default() -> Self {
        Self::new(Arc::new(SourceRegistry::default()))
    }
}

impl AcquisitionRuntime {
    pub const fn registry(&self) -> &Arc<SourceRegistry> {
        &self.registry
    }

    pub fn set_observer(&self, observer: Arc<dyn PointBatchObserver>) {
        *self.observer.write() = Some(observer);
    }

    pub fn send(&self, id: &str, bytes: &[u8]) -> data_model::Result<()> {
        let entry = self.byte_entry(id)?;
        if entry.spec.simulation.is_some() {
            return Err(data_model::Error::Io(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "simulation does not accept writes",
            )));
        }
        entry
            .session
            .byte_stream()
            .expect("validated byte entry")
            .send(bytes)
    }

    fn byte_entry(&self, id: &str) -> data_model::Result<Arc<EndpointEntry>> {
        self.entry(&EndpointId(id.into()))
            .ok()
            .filter(|entry| entry.session.byte_stream().is_some())
            .ok_or_else(|| {
                data_model::Error::PortNotFound(error::PortNotFoundError { port: id.into() })
            })
    }

    pub fn subscribe_bytes(&self, id: &str) -> Option<broadcast::Receiver<crate::ByteMessage>> {
        Some(self.byte_entry(id).ok()?.session.byte_stream()?.subscribe())
    }

    pub fn subscribe_flow(&self, id: &str) -> Option<crate::LegacyFlowReceiver> {
        Some(
            self.byte_entry(id)
                .ok()?
                .session
                .byte_stream()?
                .subscribe_flow(SourceId::new(id).ok()?),
        )
    }

    pub fn live_handle(&self, id: &str) -> Option<crate::LiveNodeHandle> {
        Some(self.byte_entry(id).ok()?.session.byte_stream()?.live(id))
    }

    pub fn config(&self, id: &str) -> Option<TransportConfig> {
        Some(self.byte_entry(id).ok()?.session.byte_stream()?.config())
    }

    pub fn stats(&self, id: &str) -> Option<TransportStats> {
        Some(self.byte_entry(id).ok()?.session.byte_stream()?.stats())
    }

    pub fn state(&self, id: &str) -> Option<ConnectionState> {
        self.snapshot(&EndpointId(id.into()))
            .ok()
            .map(|s| match s.state {
                EndpointConnectionState::Online { .. } => ConnectionState::Connected,
                EndpointConnectionState::Closed | EndpointConnectionState::Closing => {
                    ConnectionState::Disconnected
                }
                EndpointConnectionState::Degraded { .. } => ConnectionState::Error,
                _ => ConnectionState::Connecting,
            })
    }

    pub fn list_open(&self) -> Vec<String> {
        self.endpoints
            .read()
            .keys()
            .map(|id| id.0.clone())
            .collect()
    }

    pub async fn close(&self, id: &str) {
        // `close_endpoint` also cancels an in-flight open reservation. Looking only
        // in the installed endpoint map would let a slow adapter publish a session
        // after the user had already closed the device.
        let _ = self.close_endpoint(&EndpointId(id.into())).await;
    }

    pub fn update_link(
        &self,
        id: &str,
        link: TestDataLink,
        config: Option<data_model::TestDataConfig>,
    ) -> data_model::Result<()> {
        self.byte_entry(id)?
            .session
            .byte_stream()
            .expect("validated byte entry")
            .update_link(link, config)?;
        Ok(())
    }
}
