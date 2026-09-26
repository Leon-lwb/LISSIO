//! Strongly typed CAN identifiers, DLCs, payloads, and construction errors.

use serde::{Deserialize, Serialize};

/// CAN frame direction
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum CanDirection {
    #[default]
    Rx,
    Tx,
}

/// Width-aware CAN identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanId {
    Standard(StandardCanId),
    Extended(ExtendedCanId),
}

/// Standard CAN identifier (0..=0x7ff).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StandardCanId(u16);

/// Extended CAN identifier (0..=0x1fff_ffff).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtendedCanId(u32);

impl StandardCanId {
    pub const MAX: u16 = 0x07ff;

    pub const fn new(raw: u16) -> Option<Self> {
        if raw <= Self::MAX {
            Some(Self(raw))
        } else {
            None
        }
    }

    pub const fn raw(self) -> u16 {
        self.0
    }
}

impl ExtendedCanId {
    pub const MAX: u32 = 0x1fff_ffff;

    pub const fn new(raw: u32) -> Option<Self> {
        if raw <= Self::MAX {
            Some(Self(raw))
        } else {
            None
        }
    }

    pub const fn raw(self) -> u32 {
        self.0
    }
}

impl CanId {
    pub fn standard(raw: u32) -> Result<Self, CanFrameError> {
        let raw = u16::try_from(raw).map_err(|_| CanFrameError::IdOutOfRange)?;
        StandardCanId::new(raw)
            .map(Self::Standard)
            .ok_or(CanFrameError::IdOutOfRange)
    }

    pub fn extended(raw: u32) -> Result<Self, CanFrameError> {
        ExtendedCanId::new(raw)
            .map(Self::Extended)
            .ok_or(CanFrameError::IdOutOfRange)
    }

    pub fn new(raw: u32, extended: bool) -> Result<Self, CanFrameError> {
        if extended {
            Self::extended(raw)
        } else {
            Self::standard(raw)
        }
    }

    pub const fn raw(self) -> u32 {
        match self {
            Self::Standard(id) => id.raw() as u32,
            Self::Extended(id) => id.raw(),
        }
    }

    pub const fn is_extended(self) -> bool {
        matches!(self, Self::Extended(_))
    }
}

/// CAN Classic data length code (0..=8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanDlc(u8);

impl CanDlc {
    pub const MAX: u8 = 8;

    pub const fn new(raw: u8) -> Option<Self> {
        if raw <= Self::MAX {
            Some(Self(raw))
        } else {
            None
        }
    }

    pub const fn raw(self) -> u8 {
        self.0
    }

    pub const fn as_usize(self) -> usize {
        self.0 as usize
    }
}

/// Validated CAN payload representation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanFrameBody {
    Data { dlc: CanDlc, bytes: Vec<u8> },
    Remote { requested_dlc: CanDlc },
}

impl CanFrameBody {
    pub fn from_data(bytes: Vec<u8>) -> Result<Self, CanFrameError> {
        if bytes.len() > CanDlc::MAX as usize {
            return Err(CanFrameError::DataLengthMismatch);
        }
        let dlc =
            CanDlc::new(u8::try_from(bytes.len()).map_err(|_| CanFrameError::DataLengthMismatch)?)
                .ok_or(CanFrameError::DataLengthMismatch)?;
        Ok(Self::Data { dlc, bytes })
    }

    pub const fn remote(requested_dlc: CanDlc) -> Self {
        Self::Remote { requested_dlc }
    }

    pub const fn dlc(&self) -> CanDlc {
        match self {
            Self::Data { dlc, .. } | Self::Remote { requested_dlc: dlc } => *dlc,
        }
    }

    pub fn data(&self) -> &[u8] {
        match self {
            Self::Data { bytes, .. } => bytes,
            Self::Remote { .. } => &[],
        }
    }

    pub const fn is_remote(&self) -> bool {
        matches!(self, Self::Remote { .. })
    }
}

/// Validated inputs for constructing a [`CanFrame`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanFrameParts {
    pub timestamp: u64,
    pub id: CanId,
    pub body: CanFrameBody,
    pub direction: CanDirection,
}

/// Invalid CAN frame construction or deserialization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanFrameError {
    IdOutOfRange,
    InvalidDlc,
    DataLengthMismatch,
    RemoteFrameHasData,
}

impl std::fmt::Display for CanFrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::IdOutOfRange => "CAN identifier exceeds its frame format",
            Self::InvalidDlc => "CAN DLC must be between 0 and 8",
            Self::DataLengthMismatch => "CAN data length does not match DLC",
            Self::RemoteFrameHasData => "CAN remote frames cannot contain data",
        };
        f.write_str(message)
    }
}

impl std::error::Error for CanFrameError {}
