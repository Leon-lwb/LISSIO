//! Typed Lawicel SLCAN ASCII codec.
//!
//! The decoder is byte-oriented so valid ASCII frames survive adjacent serial
//! noise and non-UTF-8 padding. Every terminated line is classified
//! independently; malformed frame lines cannot poison later valid frames.

use can::{CanDirection, CanDlc, CanFrame, CanFrameBody, CanFrameError, CanId};

const MAX_LINE_BYTES: usize = 256;
const STANDARD_ID_HEX: usize = 3;
const EXTENDED_ID_HEX: usize = 8;
const TIMESTAMP_HEX: usize = 4;
const HEX_DIGITS: [char; 16] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F',
];

/// Decoded SLCAN wire frame before host timestamp/direction assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlcanFrame {
    pub id: CanId,
    pub body: CanFrameBody,
    pub device_timestamp: Option<u16>,
}

/// Known non-frame SLCAN traffic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlcanControl {
    Bitrate(u8),
    Open,
    Close,
    Version,
    SerialNumber,
    ErrorFrame {
        extended: bool,
        device_timestamp: Option<u16>,
    },
    Unknown,
}

/// One classified SLCAN line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlcanMessage {
    Frame(SlcanFrame),
    Control(SlcanControl),
}

/// Recoverable SLCAN line error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlcanDecodeError {
    InvalidFrame { line: Vec<u8> },
    LineTooLong,
}

/// Decoded messages plus recoverable errors from one `push`.
#[derive(Debug, Default)]
pub struct SlcanDecodeBatch {
    pub messages: Vec<SlcanMessage>,
    pub errors: Vec<SlcanDecodeError>,
}

impl SlcanDecodeBatch {
    pub fn frames(&self) -> impl Iterator<Item = &SlcanFrame> {
        self.messages.iter().filter_map(|message| match message {
            SlcanMessage::Frame(frame) => Some(frame),
            SlcanMessage::Control(_) => None,
        })
    }
}

/// Stateful SLCAN line decoder.
#[derive(Debug, Default)]
pub struct SlcanDecoder {
    pending: Vec<u8>,
}

impl SlcanDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, bytes: &[u8]) -> SlcanDecodeBatch {
        let mut batch = SlcanDecodeBatch::default();
        self.pending.extend_from_slice(bytes);
        let mut start = 0usize;
        for index in 0..self.pending.len() {
            if !matches!(self.pending[index], b'\r' | b'\n') {
                continue;
            }
            let line = self.pending[start..index].to_vec();
            classify_line(line, &mut batch);
            start = index + 1;
        }
        if start > 0 {
            self.pending.drain(..start);
        }
        if self.pending.len() > MAX_LINE_BYTES {
            self.pending.clear();
            batch.errors.push(SlcanDecodeError::LineTooLong);
        }
        batch
    }

    pub fn take_pending(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending)
    }
}

/// Encode a host CAN frame into a canonical SLCAN line.
pub fn encode_frame(frame: &CanFrame) -> Result<Vec<u8>, SlcanEncodeError> {
    let id = frame.id().map_err(|_| SlcanEncodeError::InvalidId)?;
    let body = frame.body().map_err(|_| SlcanEncodeError::InvalidBody)?;
    let mut line = String::with_capacity(32);
    match body {
        CanFrameBody::Data { dlc, bytes } => {
            line.push(if id.is_extended() { 'T' } else { 't' });
            push_id(&mut line, id);
            push_dlc(&mut line, dlc);
            for byte in bytes {
                line.push(HEX_DIGITS[(byte >> 4) as usize]);
                line.push(HEX_DIGITS[(byte & 0x0f) as usize]);
            }
        }
        CanFrameBody::Remote { requested_dlc } => {
            line.push(if id.is_extended() { 'R' } else { 'r' });
            push_id(&mut line, id);
            push_dlc(&mut line, requested_dlc);
        }
    }
    line.push('\r');
    Ok(line.into_bytes())
}

/// Invalid host frame at the SLCAN encoder boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlcanEncodeError {
    InvalidId,
    InvalidBody,
}

impl std::fmt::Display for SlcanEncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidId => "CAN identifier is invalid for its frame format",
            Self::InvalidBody => "CAN payload is invalid for SLCAN encoding",
        })
    }
}

impl std::error::Error for SlcanEncodeError {}

fn push_id(line: &mut String, id: CanId) {
    match id {
        CanId::Standard(value) => {
            write_hex(line, u32::from(value.raw()), STANDARD_ID_HEX);
        }
        CanId::Extended(value) => {
            write_hex(line, value.raw(), EXTENDED_ID_HEX);
        }
    }
}

fn push_dlc(line: &mut String, dlc: CanDlc) {
    line.push(HEX_DIGITS[dlc.as_usize()]);
}

fn write_hex(line: &mut String, value: u32, width: usize) {
    for shift in (0..width).rev() {
        let digit = (value >> (shift * 4)) & 0x0f;
        line.push(HEX_DIGITS[digit as usize]);
    }
}

fn classify_line(mut line: Vec<u8>, output: &mut SlcanDecodeBatch) {
    trim_line_noise(&mut line);
    if line.is_empty() {
        return;
    }
    if !matches!(
        line[0],
        b't' | b'T' | b'r' | b'R' | b'z' | b'Z' | b'S' | b'O' | b'C' | b'V' | b'N'
    ) && let Some((command, rest)) = find_frame_with_noise(&line)
    {
        match parse_frame(command, rest) {
            Ok(frame) => output.messages.push(SlcanMessage::Frame(frame)),
            Err(_) => output.errors.push(SlcanDecodeError::InvalidFrame { line }),
        }
        return;
    }
    let command = line[0];
    let rest = &line[1..];
    match command {
        b't' | b'T' | b'r' | b'R' => match parse_frame(command, rest) {
            Ok(frame) => output.messages.push(SlcanMessage::Frame(frame)),
            Err(_) => output.errors.push(SlcanDecodeError::InvalidFrame { line }),
        },
        b'z' | b'Z' => {
            let device_timestamp = parse_optional_timestamp(rest).ok().flatten();
            output
                .messages
                .push(SlcanMessage::Control(SlcanControl::ErrorFrame {
                    extended: command == b'Z',
                    device_timestamp,
                }));
        }
        b'S' if rest.len() == 1 && rest[0].is_ascii_digit() => {
            output
                .messages
                .push(SlcanMessage::Control(SlcanControl::Bitrate(rest[0] - b'0')));
        }
        b'O' if rest.is_empty() => output
            .messages
            .push(SlcanMessage::Control(SlcanControl::Open)),
        b'C' if rest.is_empty() => output
            .messages
            .push(SlcanMessage::Control(SlcanControl::Close)),
        b'V' if rest.is_empty() => output
            .messages
            .push(SlcanMessage::Control(SlcanControl::Version)),
        b'N' => output
            .messages
            .push(SlcanMessage::Control(SlcanControl::SerialNumber)),
        _ => output
            .messages
            .push(SlcanMessage::Control(SlcanControl::Unknown)),
    }
}

fn trim_line_noise(line: &mut Vec<u8>) {
    while let Some(first) = line.first().copied() {
        if first.is_ascii_whitespace() || matches!(first, 0 | b'>' | 7) {
            line.remove(0);
        } else {
            break;
        }
    }
    while let Some(last) = line.last().copied() {
        if last.is_ascii_whitespace() || matches!(last, 0 | b'>' | 7) {
            line.pop();
        } else {
            break;
        }
    }
}

fn find_frame_with_noise(line: &[u8]) -> Option<(u8, &[u8])> {
    line.iter()
        .enumerate()
        .filter(|(_, byte)| matches!(byte, b't' | b'T' | b'r' | b'R'))
        .find_map(|(index, command)| {
            let rest = line.get(index + 1..)?;
            parse_frame(*command, rest).ok().map(|_| (*command, rest))
        })
}

fn parse_frame(command: u8, rest: &[u8]) -> Result<SlcanFrame, CanFrameError> {
    let extended = matches!(command, b'T' | b'R');
    let id_len = if extended {
        EXTENDED_ID_HEX
    } else {
        STANDARD_ID_HEX
    };
    if rest.len() < id_len + 1 {
        return Err(CanFrameError::DataLengthMismatch);
    }
    let id_raw = parse_hex(&rest[..id_len]).ok_or(CanFrameError::IdOutOfRange)?;
    let id = CanId::new(id_raw, extended)?;
    let dlc_raw = hex_digit(rest[id_len]).ok_or(CanFrameError::InvalidDlc)?;
    let dlc = CanDlc::new(dlc_raw).ok_or(CanFrameError::InvalidDlc)?;
    let payload = &rest[id_len + 1..];
    let body = match command {
        b't' | b'T' => {
            let data_len = dlc.as_usize() * 2;
            if payload.len() < data_len {
                return Err(CanFrameError::DataLengthMismatch);
            }
            let mut bytes = Vec::with_capacity(dlc.as_usize());
            let (pairs, _) = payload[..data_len].as_chunks::<2>();
            for pair in pairs {
                let high = hex_digit(pair[0]).ok_or(CanFrameError::DataLengthMismatch)?;
                let low = hex_digit(pair[1]).ok_or(CanFrameError::DataLengthMismatch)?;
                bytes.push((high << 4) | low);
            }
            let timestamp = parse_optional_timestamp(&payload[data_len..])?;
            return Ok(SlcanFrame {
                id,
                body: CanFrameBody::from_data(bytes)?,
                device_timestamp: timestamp,
            });
        }
        b'r' | b'R' => {
            let timestamp = parse_optional_timestamp(payload)?;
            return Ok(SlcanFrame {
                id,
                body: CanFrameBody::remote(dlc),
                device_timestamp: timestamp,
            });
        }
        _ => CanFrameBody::remote(dlc),
    };
    Ok(SlcanFrame {
        id,
        body,
        device_timestamp: None,
    })
}

fn parse_optional_timestamp(bytes: &[u8]) -> Result<Option<u16>, CanFrameError> {
    match bytes.len() {
        0 => Ok(None),
        TIMESTAMP_HEX => parse_hex(bytes)
            .and_then(|value| u16::try_from(value).ok())
            .map(Some)
            .ok_or(CanFrameError::DataLengthMismatch),
        _ => Err(CanFrameError::DataLengthMismatch),
    }
}

fn parse_hex(bytes: &[u8]) -> Option<u32> {
    let mut value = 0u32;
    for byte in bytes {
        value = (value << 4) | u32::from(hex_digit(*byte)?);
    }
    Some(value)
}

const fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Convert a wire frame to a host frame using explicit route direction.
pub fn into_can_frame(
    frame: SlcanFrame,
    timestamp_us: u64,
    direction: CanDirection,
) -> Result<CanFrame, CanFrameError> {
    CanFrame::from_parts(can::CanFrameParts {
        timestamp: timestamp_us,
        id: frame.id,
        body: frame.body,
        direction,
    })
}
