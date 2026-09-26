//! Typed CAN display subscription filters.

use serde::{Deserialize, Serialize};

use crate::can_frame::CanFrame;
use crate::can_model::CanDirection;

/// CAN display subscription filter. Every field is optional and all fields are
/// ANDed together; this is the stable frontend request contract.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct CanFrameFilter {
    pub id: Option<u32>,
    pub id_mask: Option<u32>,
    pub id_min: Option<u32>,
    pub id_max: Option<u32>,
    pub extended: Option<bool>,
    pub rtr: Option<bool>,
    pub direction: Option<CanDirection>,
    pub data_pattern: Option<Vec<u8>>,
}

impl CanFrameFilter {
    pub fn matches(&self, frame: &CanFrame) -> bool {
        if let Some(id) = self.id
            && frame.id != id
        {
            return false;
        }
        if let Some(mask) = self.id_mask
            && (frame.id & mask) != (self.id.unwrap_or_default() & mask)
        {
            return false;
        }
        if let Some(min) = self.id_min
            && frame.id < min
        {
            return false;
        }
        if let Some(max) = self.id_max
            && frame.id > max
        {
            return false;
        }
        if let Some(extended) = self.extended
            && frame.extended != extended
        {
            return false;
        }
        if let Some(rtr) = self.rtr
            && frame.rtr != rtr
        {
            return false;
        }
        if let Some(direction) = self.direction
            && frame.direction != direction
        {
            return false;
        }
        if let Some(pattern) = &self.data_pattern
            && !contains_subslice(&frame.data, pattern)
        {
            return false;
        }
        true
    }

    pub fn validate(&self) -> Result<(), CanFilterError> {
        if let (Some(min), Some(max)) = (self.id_min, self.id_max)
            && min > max
        {
            return Err(CanFilterError::InvalidIdRange);
        }
        if self.data_pattern.as_ref().is_some_and(Vec::is_empty) {
            return Err(CanFilterError::EmptyDataPattern);
        }
        Ok(())
    }

    pub const fn is_empty(&self) -> bool {
        self.id.is_none()
            && self.id_mask.is_none()
            && self.id_min.is_none()
            && self.id_max.is_none()
            && self.extended.is_none()
            && self.rtr.is_none()
            && self.direction.is_none()
            && self.data_pattern.is_none()
    }
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    needle.is_empty()
        || (needle.len() == 1 && haystack.contains(&needle[0]))
        || (needle.len() > 1
            && haystack
                .windows(needle.len())
                .any(|window| window == needle))
}

/// Invalid display filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanFilterError {
    InvalidIdRange,
    EmptyDataPattern,
}

impl std::fmt::Display for CanFilterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::InvalidIdRange => "CAN filter id_min must not exceed id_max",
            Self::EmptyDataPattern => "CAN filter data_pattern cannot be empty",
        };
        f.write_str(message)
    }
}

impl std::error::Error for CanFilterError {}
