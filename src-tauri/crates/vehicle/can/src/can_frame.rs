//! CAN frame, direction, bitrate, filter, batch, and candleLight device info

use serde::{Deserialize, Serialize};

use crate::can_model::{CanDirection, CanDlc, CanFrameBody, CanFrameError, CanFrameParts, CanId};

// ============ CAN Frame Base Types ============

/// CAN frame — normalized CAN data model.
///
/// The public field shape is the stable IPC JSON contract. Prefer the validated
/// constructors and [`Self::parts`] in new code; custom serde normalizes remote
/// frames (rtr = true carries no payload) while preserving the wire shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanFrame {
    pub timestamp: u64,
    pub id: u32,
    pub extended: bool,
    pub rtr: bool,
    pub dlc: u8,
    pub data: Vec<u8>,
    pub direction: CanDirection,
}

#[derive(Serialize)]
struct CanFrameWireRef<'a> {
    timestamp: u64,
    id: u32,
    extended: bool,
    rtr: bool,
    dlc: u8,
    data: &'a [u8],
    direction: CanDirection,
}

#[derive(Deserialize)]
struct CanFrameWire {
    timestamp: u64,
    id: u32,
    extended: bool,
    #[serde(default)]
    rtr: bool,
    dlc: u8,
    #[serde(default)]
    data: Vec<u8>,
    #[serde(default)]
    direction: CanDirection,
}

impl CanFrame {
    /// Construct a standard data frame, truncating overlong payloads.
    pub fn new(timestamp: u64, id: u32, data: Vec<u8>, direction: CanDirection) -> Self {
        let data = data
            .into_iter()
            .take(CanDlc::MAX as usize)
            .collect::<Vec<_>>();
        let dlc = u8::try_from(data.len()).unwrap_or(CanDlc::MAX);
        Self {
            timestamp,
            id,
            extended: false,
            rtr: false,
            dlc,
            data,
            direction,
        }
    }

    pub fn from_parts(parts: CanFrameParts) -> Result<Self, CanFrameError> {
        let (rtr, dlc, data) = match parts.body {
            CanFrameBody::Data { dlc, bytes } => {
                if dlc.as_usize() != bytes.len() {
                    return Err(CanFrameError::DataLengthMismatch);
                }
                (false, dlc.raw(), bytes)
            }
            CanFrameBody::Remote { requested_dlc } => (true, requested_dlc.raw(), Vec::new()),
        };
        Ok(Self {
            timestamp: parts.timestamp,
            id: parts.id.raw(),
            extended: parts.id.is_extended(),
            rtr,
            dlc,
            data,
            direction: parts.direction,
        })
    }

    pub fn data(
        timestamp: u64,
        id: CanId,
        data: Vec<u8>,
        direction: CanDirection,
    ) -> Result<Self, CanFrameError> {
        Self::from_parts(CanFrameParts {
            timestamp,
            id,
            body: CanFrameBody::from_data(data)?,
            direction,
        })
    }

    pub fn remote(
        timestamp: u64,
        id: CanId,
        requested_dlc: CanDlc,
        direction: CanDirection,
    ) -> Self {
        Self::from_parts(CanFrameParts {
            timestamp,
            id,
            body: CanFrameBody::remote(requested_dlc),
            direction,
        })
        .expect("remote frame construction is valid")
    }

    pub fn id(&self) -> Result<CanId, CanFrameError> {
        CanId::new(self.id, self.extended)
    }

    pub fn body(&self) -> Result<CanFrameBody, CanFrameError> {
        let dlc = CanDlc::new(self.dlc).ok_or(CanFrameError::InvalidDlc)?;
        if self.rtr {
            return if self.data.is_empty() {
                Ok(CanFrameBody::Remote { requested_dlc: dlc })
            } else {
                Err(CanFrameError::RemoteFrameHasData)
            };
        }
        if dlc.as_usize() != self.data.len() {
            return Err(CanFrameError::DataLengthMismatch);
        }
        Ok(CanFrameBody::Data {
            dlc,
            bytes: self.data.clone(),
        })
    }

    pub fn parts(&self) -> Result<CanFrameParts, CanFrameError> {
        Ok(CanFrameParts {
            timestamp: self.timestamp,
            id: self.id()?,
            body: self.body()?,
            direction: self.direction,
        })
    }

    pub fn validate(&self) -> Result<(), CanFrameError> {
        self.parts().map(|_| ())
    }

    /// Number of data bytes (based on DLC).
    pub const fn data_len(&self) -> usize {
        self.dlc as usize
    }
}

impl Serialize for CanFrame {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        CanFrameWireRef {
            timestamp: self.timestamp,
            id: self.id,
            extended: self.extended,
            rtr: self.rtr,
            dlc: self.dlc,
            data: &self.data,
            direction: self.direction,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for CanFrame {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = CanFrameWire::deserialize(deserializer)?;
        let data = if wire.rtr { Vec::new() } else { wire.data };
        let frame = Self {
            timestamp: wire.timestamp,
            id: wire.id,
            extended: wire.extended,
            rtr: wire.rtr,
            dlc: wire.dlc,
            data,
            direction: wire.direction,
        };
        frame.validate().map_err(serde::de::Error::custom)?;
        Ok(frame)
    }
}

// ============ CAN Filter and Batch ============

/// CAN filter configuration — controls which frames pass through via ID bitmask
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanFilter {
    pub enabled: bool,
    pub id_mask_std: u16,
    pub id_mask_ext: u32,
}

impl CanFilter {
    #[allow(clippy::missing_const_for_fn)]
    pub fn matches(&self, frame: &CanFrame) -> bool {
        if !self.enabled {
            return true;
        }
        if frame.extended {
            (frame.id & self.id_mask_ext) != 0
        } else {
            (frame.id & u32::from(self.id_mask_std)) != 0
        }
    }
}

/// CAN frame batch (for bulk transfer) — monotonically increasing `seq`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanFrameBatch {
    pub seq: u64,
    pub frames: Vec<CanFrame>,
}

impl CanFrameBatch {
    pub const fn new(seq: u64) -> Self {
        Self {
            seq,
            frames: Vec::new(),
        }
    }

    pub const fn len(&self) -> usize {
        self.frames.len()
    }

    pub const fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
}

/// candleLight device information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandleDeviceInfo {
    pub bus: u8,
    pub address: u8,
    pub vid: u16,
    pub pid: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
}
