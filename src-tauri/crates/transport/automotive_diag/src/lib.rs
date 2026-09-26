//! `automotive_diag` — UDS/OBD/J1939 diagnostic endpoint adapters.

mod engine;
mod node_driver;

pub use engine::DiagnosticEngine;
pub use node_driver::{
    DIAGNOSTIC_DRIVER_ID, DIAGNOSTIC_INVOKE_PORT_ID, DiagnosticNodeConfig, DiagnosticNodeDriver,
};
