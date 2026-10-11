//! slcan (Lawicel ASCII) protocol engine.
//!
//! Wire framing and validation live in [`slcan_codec`]; this adapter maps typed
//! messages to the common [`ProtocolEngine`] contract.

use std::time::{SystemTime, UNIX_EPOCH};

use can::{CanDirection, CanFrame};
use protocol::{FeedOutput, ProtocolEngine, split_at_boundaries};

use crate::slcan_codec::{SlcanDecoder, SlcanMessage, encode_frame, into_can_frame};

/// Stateful SLCAN protocol engine.
pub struct SlcanEngine {
    decoder: SlcanDecoder,
}

impl SlcanEngine {
    pub fn new() -> Self {
        Self {
            decoder: SlcanDecoder::new(),
        }
    }

    fn now_us() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_micros()).unwrap_or(0))
    }

    pub fn feed_with_direction(&mut self, data: &[u8], direction: CanDirection) -> FeedOutput {
        let decoded = self.decoder.push(data);
        let timestamp = Self::now_us();
        let mut frames = Vec::with_capacity(decoded.messages.len());
        for message in decoded.messages {
            if let SlcanMessage::Frame(frame) = message
                && let Ok(frame) = into_can_frame(frame, timestamp, direction)
            {
                frames.push(frame);
            }
        }
        let _ = decoded.errors;
        FeedOutput::from_can_frames(frames)
    }
}

impl ProtocolEngine for SlcanEngine {
    fn feed(&mut self, data: &[u8]) -> FeedOutput {
        self.feed_with_direction(data, CanDirection::Rx)
    }

    fn encode_can(&mut self, frame: &CanFrame) -> Vec<u8> {
        encode_frame(frame).unwrap_or_default()
    }

    fn encode_channel(&mut self, _channel: usize, value: f32) -> Vec<u8> {
        protocol::text::encode_ascii_value(value)
    }

    fn encode_channels(&mut self, values: &[f32]) -> Vec<u8> {
        protocol::text::encode_ascii_values(values)
    }

    fn name(&self) -> &'static str {
        "Slcan"
    }

    fn encode_frame(&mut self, _frame: &data_model::DataFrame) -> Vec<u8> {
        Vec::new()
    }

    fn split_aligned(&self, data: &[u8], workers: usize) -> Option<Vec<std::ops::Range<usize>>> {
        let boundaries = data
            .iter()
            .enumerate()
            .filter(|(_, byte)| matches!(byte, b'\r' | b'\n'))
            .map(|(index, _)| index + 1)
            .collect::<Vec<_>>();
        Some(split_at_boundaries(&boundaries, workers))
    }

    fn take_pending(&mut self) -> Vec<u8> {
        self.decoder.take_pending()
    }

    fn new_worker(&self) -> Box<dyn ProtocolEngine> {
        Box::new(Self::new())
    }
}

impl Default for SlcanEngine {
    fn default() -> Self {
        Self::new()
    }
}
