//! Transport backend extension contracts.
//!
//! The orchestration layer owns these contracts while hardware/network crates
//! implement them.  A backend turns one persisted [`TransportConfig`] into the
//! same byte-oriented connection regardless of the concrete device.

use async_trait::async_trait;
use data_model::{Result, TransportConfig};
use schema_types::TestDataLink;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

/// Runtime controls that are independent from the concrete transport.
pub trait ConnectionControl: Send + Sync {
    /// Stop background I/O and release the device.
    fn close(&self);

    /// Apply an optional runtime link update.
    ///
    /// Backends that support the update return the effective persisted config;
    /// other backends return `None` without treating it as an error.
    fn update_link(
        &self,
        _link: TestDataLink,
        _config: Option<data_model::TestDataConfig>,
    ) -> Result<Option<TransportConfig>> {
        Ok(None)
    }
}

/// A live, byte-oriented connection produced by every backend.
pub struct TransportConnection {
    pub write_tx: mpsc::Sender<Vec<u8>>,
    pub data_tx: broadcast::Sender<Vec<u8>>,
    pub control: Arc<dyn ConnectionControl>,
}

impl TransportConnection {
    pub fn new(
        write_tx: mpsc::Sender<Vec<u8>>,
        data_tx: broadcast::Sender<Vec<u8>>,
        control: Arc<dyn ConnectionControl>,
    ) -> Self {
        Self {
            write_tx,
            data_tx,
            control,
        }
    }

    /// Adapt the common cancellation-flag runtime used by byte transports.
    pub fn from_cancel_flag(
        write_tx: mpsc::Sender<Vec<u8>>,
        data_tx: broadcast::Sender<Vec<u8>>,
        cancel: Arc<AtomicBool>,
    ) -> Self {
        Self::new(write_tx, data_tx, Arc::new(CancelFlag(cancel)))
    }
}

struct CancelFlag(Arc<AtomicBool>);

impl ConnectionControl for CancelFlag {
    fn close(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// Factory extension point for serial, network, USB and future transports.
#[async_trait]
pub trait TransportBackend: Send + Sync {
    /// Stable diagnostic name used in errors and logs.
    fn name(&self) -> &'static str;

    /// Whether this backend owns the supplied configuration variant.
    fn accepts(&self, config: &TransportConfig) -> bool;

    /// Open a connection. Called only after [`Self::accepts`] returned true.
    async fn open(
        &self,
        config: TransportConfig,
        link: TestDataLink,
    ) -> Result<TransportConnection>;
}
