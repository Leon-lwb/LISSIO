use crate::{BatchPayload, Domain, RecordingError};

const VERSION: u8 = 1;

pub fn encode(payload: &BatchPayload) -> Result<Vec<u8>, RecordingError> {
    let mut out = Vec::with_capacity(payload.effective_bytes().saturating_add(16));
    out.push(VERSION);
    match payload {
        BatchPayload::Bytes { data } => out.extend_from_slice(data),
        BatchPayload::String { values } => {
            put_len(&mut out, values.len())?;
            for value in values {
                put_len(&mut out, value.len())?;
                out.extend_from_slice(value.as_bytes());
            }
        }
        BatchPayload::Float { values } => put_floats(&mut out, values),
        BatchPayload::Spectrum {
            frequencies,
            values,
        } => {
            put_len(&mut out, frequencies.len())?;
            put_floats(&mut out, frequencies);
            put_floats(&mut out, values);
        }
    }
    Ok(out)
}

pub fn decode(domain: Domain, bytes: &[u8]) -> Result<BatchPayload, RecordingError> {
    let Some((&version, data)) = bytes.split_first() else {
        return Err(RecordingError::Corrupt("empty payload".into()));
    };
    if version != VERSION {
        return Err(RecordingError::Corrupt(format!(
            "unsupported payload version {version}"
        )));
    }
    match domain {
        Domain::Bytes => Ok(BatchPayload::Bytes {
            data: data.to_vec(),
        }),
        Domain::String => decode_strings(data),
        Domain::Float => Ok(BatchPayload::Float {
            values: decode_floats(data)?,
        }),
        Domain::Spectrum => decode_spectrum(data),
    }
}

pub fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

fn put_len(out: &mut Vec<u8>, len: usize) -> Result<(), RecordingError> {
    let len =
        u64::try_from(len).map_err(|_| RecordingError::Invalid("payload too large".into()))?;
    out.extend_from_slice(&len.to_le_bytes());
    Ok(())
}

fn put_floats(out: &mut Vec<u8>, values: &[f64]) {
    out.extend(values.iter().flat_map(|value| value.to_le_bytes()));
}

fn take_u64(data: &mut &[u8]) -> Result<u64, RecordingError> {
    let bytes = data
        .get(..8)
        .ok_or_else(|| RecordingError::Corrupt("truncated length".into()))?;
    *data = &data[8..];
    Ok(u64::from_le_bytes(
        bytes.try_into().expect("length checked"),
    ))
}

fn decode_floats(data: &[u8]) -> Result<Vec<f64>, RecordingError> {
    if !data.len().is_multiple_of(8) {
        return Err(RecordingError::Corrupt("unaligned float payload".into()));
    }
    Ok(data
        .chunks_exact(8)
        .map(|bytes| f64::from_le_bytes(bytes.try_into().expect("chunk is eight bytes")))
        .collect())
}

fn decode_strings(mut data: &[u8]) -> Result<BatchPayload, RecordingError> {
    let count = usize::try_from(take_u64(&mut data)?)
        .map_err(|_| RecordingError::Corrupt("string count overflow".into()))?;
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        let len = usize::try_from(take_u64(&mut data)?)
            .map_err(|_| RecordingError::Corrupt("string length overflow".into()))?;
        let bytes = data
            .get(..len)
            .ok_or_else(|| RecordingError::Corrupt("truncated string".into()))?;
        values.push(
            String::from_utf8(bytes.to_vec())
                .map_err(|error| RecordingError::Corrupt(error.to_string()))?,
        );
        data = &data[len..];
    }
    if !data.is_empty() {
        return Err(RecordingError::Corrupt("trailing string payload".into()));
    }
    Ok(BatchPayload::String { values })
}

fn decode_spectrum(mut data: &[u8]) -> Result<BatchPayload, RecordingError> {
    let bins = usize::try_from(take_u64(&mut data)?)
        .map_err(|_| RecordingError::Corrupt("spectrum size overflow".into()))?;
    let split = bins
        .checked_mul(8)
        .ok_or_else(|| RecordingError::Corrupt("spectrum size overflow".into()))?;
    let frequency_bytes = data
        .get(..split)
        .ok_or_else(|| RecordingError::Corrupt("truncated frequencies".into()))?;
    data = &data[split..];
    let frequencies = decode_floats(frequency_bytes)?;
    let values = decode_floats(data)?;
    if frequencies.len() != values.len() {
        return Err(RecordingError::Corrupt(
            "spectrum columns differ in length".into(),
        ));
    }
    Ok(BatchPayload::Spectrum {
        frequencies,
        values,
    })
}
