//! Persisted device identity and simulation configuration. No runtime dependencies.

pub use crate::device_tree::DriverId;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverPayload {
    pub driver_id: crate::device_tree::DriverId,
    pub schema_version: u32,
    pub payload: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DevicePortDirection {
    Input,
    Output,
    Bidirectional,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DevicePortDomain {
    Bytes,
    Points,
    Events,
    Numeric,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePort {
    pub id: String,
    pub direction: DevicePortDirection,
    pub domain: DevicePortDomain,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalParameters {
    pub waveform: TestWaveform,
    pub frequency: f64,
    pub amplitude: f64,
    pub offset: f64,
}

impl Default for SignalParameters {
    fn default() -> Self {
        Self {
            waveform: TestWaveform::Sine,
            frequency: 1.0,
            amplitude: 1.0,
            offset: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TestWaveform {
    Sine,
    Square,
    Triangle,
    Sawtooth,
    Random,
    Dc,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationConfig {
    pub signal: SignalParameters,
    pub sample_rate: u32,
    pub seed: u32,
    pub channels: u32,
    pub overrides: BTreeMap<String, SignalParameters>,
    pub reference_node_id: Option<String>,
    /// Explicit encoding configuration, interpreted by the protocol layer.
    pub encoding: Option<Value>,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            signal: SignalParameters::default(),
            sample_rate: 100,
            seed: 1,
            channels: 4,
            overrides: BTreeMap::new(),
            reference_node_id: None,
            encoding: None,
        }
    }
}
