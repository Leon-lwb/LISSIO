//! Stable, payload-generic contracts for Lissio's typed flow data plane.
//!
//! The envelope is generic deliberately: byte chunks, point batches, events,
//! and numeric projections travel on separate typed lanes. Dynamic JSON and
//! runtime downcasts are not part of the hot path.

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Stable identity of a source across reconnects.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SourceId(String);

impl SourceId {
    /// Construct a non-empty source identifier.
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidSourceId> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(InvalidSourceId);
        }
        Ok(Self(value))
    }

    /// Borrow the identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SourceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// A source identifier was empty or whitespace-only.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InvalidSourceId;

impl fmt::Display for InvalidSourceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("source id must not be empty")
    }
}

impl std::error::Error for InvalidSourceId {}

/// Direction relative to Lissio.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Receive,
    Transmit,
}

/// Unit in which a loss can be stated honestly.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum LostUnit {
    Bytes,
    Messages,
    Samples,
    Unknown,
}

/// Discontinuity immediately before an envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct FlowGap {
    pub first_missing_sequence: u64,
    pub last_missing_sequence: u64,
    pub lost_units: Option<u64>,
    pub unit: LostUnit,
}

impl FlowGap {
    /// Number of missing sequence positions, saturating on malformed input.
    pub const fn missing_sequences(&self) -> u64 {
        self.last_missing_sequence
            .saturating_sub(self.first_missing_sequence)
            .saturating_add(1)
    }
}

/// Common metadata carried by every typed flow lane.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct FlowEnvelope<T> {
    pub source_id: SourceId,
    pub connection_epoch: u64,
    pub first_sequence: u64,
    pub last_sequence: u64,
    pub observed_time_unix_ns: i64,
    pub direction: Direction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap_before: Option<FlowGap>,
    pub payload: T,
}

impl<T> FlowEnvelope<T> {
    /// Transform the payload without changing delivery metadata.
    pub fn map<U>(self, transform: impl FnOnce(T) -> U) -> FlowEnvelope<U> {
        FlowEnvelope {
            source_id: self.source_id,
            connection_epoch: self.connection_epoch,
            first_sequence: self.first_sequence,
            last_sequence: self.last_sequence,
            observed_time_unix_ns: self.observed_time_unix_ns,
            direction: self.direction,
            gap_before: self.gap_before,
            payload: transform(self.payload),
        }
    }
}

/// Transport framing. Only stream chunks may be coalesced.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum Framing {
    Stream,
    Datagram,
    Message,
}

/// Position of this chunk in its framing unit.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum Boundary {
    Complete,
    Start,
    Continue,
    End,
}

/// Immutable byte payload with explicit framing semantics.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BytesChunk {
    pub bytes: Bytes,
    pub framing: Framing,
    pub boundary: Boundary,
}

impl BytesChunk {
    pub fn complete(bytes: impl Into<Bytes>, framing: Framing) -> Self {
        Self {
            bytes: bytes.into(),
            framing,
            boundary: Boundary::Complete,
        }
    }

    /// Whether this chunk can be joined to a following chunk without changing semantics.
    pub const fn is_coalescible_stream(&self) -> bool {
        matches!(self.framing, Framing::Stream)
            && matches!(
                self.boundary,
                Boundary::Complete | Boundary::Continue | Boundary::End
            )
    }
}

/// Cold-path payload declaration used by registries and graph validation.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum PayloadKind {
    Bytes,
    Points,
    Events,
    Numeric,
}

// 手动 TS 实现: wire 为纯字符串 (serde transparent), derive 会因无法解析
// transparent 属性产生误报警告, 这里直接给出与 wire 一致的 string 投影。
impl ts_rs::TS for SourceId {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;

    fn name(_: &ts_rs::Config) -> String {
        "SourceId".to_owned()
    }

    fn inline(_: &ts_rs::Config) -> String {
        "string".to_owned()
    }

    fn decl(cfg: &ts_rs::Config) -> String {
        format!("type {} = {};", Self::name(cfg), Self::inline(cfg))
    }

    fn output_path() -> Option<std::path::PathBuf> {
        Some("SourceId.ts".into())
    }
}

#[cfg(test)]
mod tests;
