//! CAN frame ring buffer — overwrites oldest data + version number + incremental cursor read

use std::collections::VecDeque;

use crate::can_frame::CanFrame;

/// Absolute read cursor into the monotonically versioned CAN buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct CanCursor(u64);

impl CanCursor {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn value(self) -> u64 {
        self.0
    }
}

/// One incremental read from a [`CanBuffer`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanReadResult {
    pub frames: Vec<CanFrame>,
    pub next_cursor: CanCursor,
    pub dropped: u64,
}

impl CanReadResult {
    pub const fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
}

/// CAN frame ring buffer
///
/// - Capacity limit: drops oldest frame when exceeding `max_size`
/// - Version number: monotonically increases on each `push`, used for cross-shard sync
/// - Incremental cursor: `read_from` supports subscription streams pulling incrementally by `version`
#[derive(Debug)]
pub struct CanBuffer {
    frames: VecDeque<CanFrame>,
    max_size: usize,
    version: u64,
}

impl CanBuffer {
    pub fn new(max_size: usize) -> Self {
        let max_size = max_size.max(1);
        Self {
            frames: VecDeque::with_capacity(max_size.min(8192)),
            max_size,
            version: 0,
        }
    }

    pub fn push(&mut self, frame: CanFrame) {
        if self.frames.len() >= self.max_size {
            self.frames.pop_front();
        }
        self.frames.push_back(frame);
        self.version = self.version.wrapping_add(1);
    }

    pub const fn version(&self) -> u64 {
        self.version
    }

    pub fn cursor(&self) -> CanCursor {
        CanCursor::new(self.oldest_sequence())
    }

    pub fn get_recent(&self, count: usize) -> Vec<CanFrame> {
        let n = count.min(self.frames.len());
        self.frames.iter().rev().take(n).rev().cloned().collect()
    }

    /// Read at most `max` frames beginning at `cursor`.
    ///
    /// The cursor is clamped to the oldest retained sequence and never moves
    /// backwards. After reaching `version`, later reads return no frames until a
    /// new push or clear advances the version.
    pub fn read_from(&self, cursor: CanCursor, max: usize) -> CanReadResult {
        let oldest = self.oldest_sequence();
        let mut start = cursor.0.max(oldest);
        let dropped = start.saturating_sub(cursor.0);
        if start >= self.version || max == 0 {
            return CanReadResult {
                frames: Vec::new(),
                next_cursor: CanCursor::new(start),
                dropped,
            };
        }
        let available = usize::try_from(self.version - start).unwrap_or(usize::MAX);
        let count = available.min(max);
        let skip = usize::try_from(start.saturating_sub(oldest)).unwrap_or(0);
        let frames = self.frames.iter().skip(skip).take(count).cloned().collect();
        start += count as u64;
        CanReadResult {
            frames,
            next_cursor: CanCursor::new(start),
            dropped,
        }
    }

    pub fn clear(&mut self) {
        self.frames.clear();
        self.version = self.version.wrapping_add(1);
    }

    pub fn set_max_size(&mut self, max_size: usize) {
        self.max_size = max_size.max(1);
        while self.frames.len() > self.max_size {
            self.frames.pop_front();
        }
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub const fn capacity(&self) -> usize {
        self.max_size
    }

    fn oldest_sequence(&self) -> u64 {
        self.version.saturating_sub(self.frames.len() as u64)
    }
}
