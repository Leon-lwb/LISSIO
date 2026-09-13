//! Byte-level S7 server simulation for loopback tests.
//!
//! Speaks just enough TPKT/COTP/S7comm to satisfy `tokio-s7`: COTP connect
//! confirm, PDU-size negotiation, and Read/Write variable PDUs backed by an
//! in-memory PLC image with per-bit write semantics.

// 字节级协议仿真的偏移/长度转换均为有界测试值, 显式窄化是刻意的 wire 数学
#![allow(clippy::cast_possible_truncation)]

use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

pub const AREA_INPUTS: u8 = 0x81;
pub const AREA_OUTPUTS: u8 = 0x82;
pub const AREA_MARKERS: u8 = 0x83;
pub const AREA_DB: u8 = 0x84;

/// Memory regions are bounded so out-of-range reads return the S7
/// "invalid address" return code (0x05), like a real CPU.
const REGION_SIZE: usize = 4_096;
const NEGOTIATED_PDU: u16 = 480;
const ITEM_WIRE_LEN: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ItemRecord {
    pub function: u8,
    pub area: u8,
    pub db_number: u16,
    pub byte_address: u32,
    pub bit_address: u32,
    pub count: u16,
}

#[derive(Default)]
struct Memory {
    regions: HashMap<(u8, u16), [u8; REGION_SIZE]>,
}

impl Memory {
    fn region_mut(&mut self, area: u8, db: u16) -> &mut [u8; REGION_SIZE] {
        self.regions
            .entry((area, db))
            .or_insert_with(|| [0_u8; REGION_SIZE])
    }

    fn read(&self, area: u8, db: u16, offset: u32, len: u16) -> Option<Vec<u8>> {
        let start = usize::try_from(offset).ok()?;
        let end = start.checked_add(usize::from(len))?;
        if end > REGION_SIZE {
            return None;
        }
        // Untouched memory reads as zeros, like a real PLC.
        Some(self.regions.get(&(area, db)).map_or_else(
            || vec![0_u8; end - start],
            |region| region[start..end].to_vec(),
        ))
    }

    fn write_bytes(&mut self, area: u8, db: u16, offset: u32, bytes: &[u8]) -> bool {
        let Ok(start) = usize::try_from(offset) else {
            return false;
        };
        let Some(end) = start.checked_add(bytes.len()) else {
            return false;
        };
        if end > REGION_SIZE {
            return false;
        }
        self.region_mut(area, db)[start..end].copy_from_slice(bytes);
        true
    }

    fn write_bit(&mut self, area: u8, db: u16, offset: u32, bit: u32, value: bool) -> bool {
        let Ok(start) = usize::try_from(offset) else {
            return false;
        };
        if start >= REGION_SIZE || bit > 7 {
            return false;
        }
        let mask = 1_u8 << bit;
        let region = self.region_mut(area, db);
        if value {
            region[start] |= mask;
        } else {
            region[start] &= !mask;
        }
        true
    }
}

/// A loopback S7 server bound to an ephemeral port.
pub struct MockServer {
    pub port: u16,
    memory: Arc<Mutex<Memory>>,
    records: Arc<Mutex<Vec<ItemRecord>>>,
}

/// Version of the server that closes the first connection after the first
/// data PDU, forcing the adapter to reconnect on the next request.
pub struct ReconnectingMockServer {
    pub port: u16,
    pub connections: Arc<std::sync::atomic::AtomicUsize>,
}

impl MockServer {
    pub async fn spawn() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
        let port = listener.local_addr().expect("local addr").port();
        let memory = Arc::new(Mutex::new(Memory::default()));
        let records = Arc::new(Mutex::new(Vec::new()));
        let server = Self {
            port,
            memory: Arc::clone(&memory),
            records: Arc::clone(&records),
        };
        tokio::spawn(serve_forever(listener, memory, records));
        server
    }

    pub async fn poke(&self, area: u8, db: u16, offset: u32, bytes: &[u8]) {
        let mut memory = self.memory.lock().await;
        assert!(memory.write_bytes(area, db, offset, bytes));
    }

    pub async fn peek(&self, area: u8, db: u16, offset: u32, len: u16) -> Vec<u8> {
        self.memory
            .lock()
            .await
            .read(area, db, offset, len)
            .expect("in-range peek")
    }

    pub async fn records(&self) -> Vec<ItemRecord> {
        self.records.lock().await.clone()
    }
}

impl ReconnectingMockServer {
    pub async fn spawn() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
        let port = listener.local_addr().expect("local addr").port();
        let connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = Arc::clone(&connections);
        tokio::spawn(async move {
            let memory = Arc::new(Mutex::new(Memory::default()));
            let records = Arc::new(Mutex::new(Vec::new()));
            // First connection: complete the handshake, consume one data PDU
            // without answering, then vanish so the adapter must re-establish
            // the session.
            let (mut first, _) = listener.accept().await.expect("first accept");
            observed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            complete_handshake(&mut first, &memory, &records).await;
            let _ = read_frame(&mut first).await;
            drop(first);
            let (second, _) = listener.accept().await.expect("second accept");
            observed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            serve_stream(second, memory, records).await;
        });
        Self { port, connections }
    }
}

/// Server that completes the handshake and then never answers data PDUs, for
/// timeout behaviour tests.
pub async fn spawn_silent_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let port = listener.local_addr().expect("local addr").port();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let memory = Arc::new(Mutex::new(Memory::default()));
        let records = Arc::new(Mutex::new(Vec::new()));
        complete_handshake(&mut stream, &memory, &records).await;
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
    });
    port
}

async fn serve_forever(
    listener: TcpListener,
    memory: Arc<Mutex<Memory>>,
    records: Arc<Mutex<Vec<ItemRecord>>>,
) {
    while let Ok((stream, _)) = listener.accept().await {
        let memory = Arc::clone(&memory);
        let records = Arc::clone(&records);
        tokio::spawn(serve_stream(stream, memory, records));
    }
}

/// COTP connect confirm plus S7 setup negotiation.
async fn complete_handshake(
    stream: &mut TcpStream,
    memory: &Arc<Mutex<Memory>>,
    records: &Arc<Mutex<Vec<ItemRecord>>>,
) -> bool {
    let Some(cotp) = read_frame(stream).await else {
        return false;
    };
    if cotp.get(5) != Some(&0xE0) {
        return false;
    }
    if stream.write_all(&cotp_cc_frame()).await.is_err() {
        return false;
    }
    let Some(setup) = read_frame(stream).await else {
        return false;
    };
    match respond(&setup, memory, records).await {
        Some(reply) => stream.write_all(&reply).await.is_ok(),
        None => false,
    }
}

async fn serve_stream(
    mut stream: TcpStream,
    memory: Arc<Mutex<Memory>>,
    records: Arc<Mutex<Vec<ItemRecord>>>,
) {
    while let Some(frame) = read_frame(&mut stream).await {
        match frame.get(5) {
            Some(0xE0) => {
                if stream.write_all(&cotp_cc_frame()).await.is_err() {
                    break;
                }
            }
            // COTP disconnect request: the peer is going away.
            Some(0x80) => break,
            Some(0xF0) => match respond(&frame, &memory, &records).await {
                Some(reply) => {
                    if stream.write_all(&reply).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
            _ => break,
        }
    }
}

async fn read_frame(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut head = [0_u8; 4];
    stream.read_exact(&mut head).await.ok()?;
    let length = usize::from(u16::from_be_bytes([head[2], head[3]]));
    if length < 4 {
        return None;
    }
    let mut frame = vec![0_u8; length];
    frame[..4].copy_from_slice(&head);
    stream.read_exact(&mut frame[4..]).await.ok()?;
    Some(frame)
}

fn cotp_cc_frame() -> Vec<u8> {
    // TPKT (4) + CotpConnection connect confirm (18 bytes total, so the COTP
    // length field is 0x11): dest/src refs, flags, TPDU-size and TSAP params.
    let mut frame = vec![0x03, 0x00, 0x00, 0x16];
    frame.extend_from_slice(&[
        0x11, 0xD0, 0x00, 0x00, 0x00, 0x01, 0x00, 0xC0, 0x01, 0x0A, 0xC1, 0x02, 0x01, 0x00, 0xC2,
        0x02, 0x03, 0x01,
    ]);
    frame
}

fn ack_header(pdu_reference: u16, parameter_len: u16, data_len: u16) -> Vec<u8> {
    vec![
        0x32,
        0x03,
        0x00,
        0x00,
        (pdu_reference >> 8) as u8,
        pdu_reference as u8,
        (parameter_len >> 8) as u8,
        parameter_len as u8,
        (data_len >> 8) as u8,
        data_len as u8,
        0x00,
        0x00,
    ]
}

fn frame_from(cotp_data: &[u8], header: &[u8], parameter: &[u8], datum: &[u8]) -> Vec<u8> {
    let total = 4 + cotp_data.len() + header.len() + parameter.len() + datum.len();
    let mut frame = Vec::with_capacity(total);
    frame.extend_from_slice(&0x03_00_u16.to_be_bytes());
    frame.extend_from_slice(&u16::try_from(total).expect("frame fits u16").to_be_bytes());
    frame.extend_from_slice(cotp_data);
    frame.extend_from_slice(header);
    frame.extend_from_slice(parameter);
    frame.extend_from_slice(datum);
    frame
}

/// (pdu_reference, function, item_count, items after FC+count, datum).
type S7RequestParts<'a> = (u16, u8, u8, &'a [u8], &'a [u8]);

fn items(frame: &[u8]) -> Option<S7RequestParts<'_>> {
    // DtData frame: TPKT(4) + COTP(3) + header. Job requests carry a 10-byte
    // header; AckData responses would carry 12 but the mock only answers.
    const PDU_START: usize = 7;
    if frame.len() < PDU_START + 10 {
        return None;
    }
    let pdu_reference = u16::from_be_bytes([frame[11], frame[12]]);
    let parameter_len = usize::from(u16::from_be_bytes([frame[13], frame[14]]));
    let data_len = usize::from(u16::from_be_bytes([frame[15], frame[16]]));
    let parameter = frame.get(PDU_START + 10..PDU_START + 10 + parameter_len)?;
    let datum =
        frame.get(PDU_START + 10 + parameter_len..PDU_START + 10 + parameter_len + data_len)?;
    let function = *parameter.first()?;
    let item_count = *parameter.get(1)?;
    Some((pdu_reference, function, item_count, &parameter[2..], datum))
}

fn parse_items(encoded: &[u8], count: usize) -> Vec<ItemRecord> {
    encoded
        .as_chunks::<ITEM_WIRE_LEN>()
        .0
        .iter()
        .take(count)
        .map(|chunk| ItemRecord {
            function: 0,
            area: chunk[8],
            db_number: u16::from_be_bytes([chunk[6], chunk[7]]),
            byte_address: u32::from_be_bytes([0x00, chunk[9], chunk[10], chunk[11]]) >> 3,
            bit_address: u32::from(chunk[11]) & 0x07,
            count: u16::from_be_bytes([chunk[4], chunk[5]]),
        })
        .collect()
}

async fn respond(
    frame: &[u8],
    memory: &Arc<Mutex<Memory>>,
    records: &Arc<Mutex<Vec<ItemRecord>>>,
) -> Option<Vec<u8>> {
    let (pdu_reference, function, item_count, item_bytes, datum) = items(frame)?;
    let parsed = parse_items(item_bytes, usize::from(item_count));
    let cotp = [0x02, 0xF0, 0x80];
    match function {
        // Setup communication: echo a negotiated PDU length. The setup
        // parameter is FC(1) reserved(1) amq(2) amq(2) pdu(2), and `items`
        // already skipped the first two bytes.
        0xF0 => {
            let requested = u16::from_be_bytes([*item_bytes.get(4)?, *item_bytes.get(5)?]);
            let negotiated = requested.min(NEGOTIATED_PDU);
            let parameter = [
                0xF0,
                0x00,
                0x00,
                0x01,
                0x00,
                0x01,
                (negotiated >> 8) as u8,
                negotiated as u8,
            ];
            Some(frame_from(
                &cotp,
                &ack_header(pdu_reference, 8, 0),
                &parameter,
                &[],
            ))
        }
        // Read variable: one data item per request item.
        0x04 => {
            let memory = memory.lock().await;
            let mut datum = Vec::new();
            for (index, item) in parsed.iter().enumerate() {
                let mut record = *item;
                record.function = function;
                records.lock().await.push(record);
                let Some(bytes) =
                    memory.read(item.area, item.db_number, item.byte_address, item.count)
                else {
                    datum.extend_from_slice(&[0x05, 0x04, 0x00, 0x00]);
                    continue;
                };
                let bits = u16::try_from(usize::from(item.count) * 8).expect("read fits");
                datum.push(0xFF);
                datum.push(0x04);
                datum.extend_from_slice(&bits.to_be_bytes());
                datum.extend_from_slice(&bytes);
                // Odd-length data items are padded except after the last one.
                if index + 1 != parsed.len() && (4 + bytes.len()) % 2 == 1 {
                    datum.push(0x00);
                }
            }
            let data_len = u16::try_from(datum.len()).expect("datum fits");
            Some(frame_from(
                &cotp,
                &ack_header(pdu_reference, 2, data_len),
                &[0x04, item_count],
                &datum,
            ))
        }
        // Write variable: apply the data items, answer with return codes.
        0x05 => {
            let mut memory = memory.lock().await;
            let mut returns = Vec::with_capacity(parsed.len());
            let mut datum_offset = 0usize;
            for (index, item) in parsed.iter().enumerate() {
                let mut record = *item;
                record.function = function;
                records.lock().await.push(record);
                let chunk = datum.get(datum_offset..datum_offset + 4)?;
                let transport = chunk[1];
                let bits = usize::from(u16::from_be_bytes([chunk[2], chunk[3]]));
                let byte_count = match transport {
                    0x03 => 1,
                    0x04 => bits / 8,
                    _ => return None,
                };
                let bytes = datum.get(datum_offset + 4..datum_offset + 4 + byte_count)?;
                let applied = if transport == 0x03 {
                    memory.write_bit(
                        item.area,
                        item.db_number,
                        item.byte_address,
                        item.bit_address,
                        bytes[0] != 0,
                    )
                } else {
                    memory.write_bytes(item.area, item.db_number, item.byte_address, bytes)
                };
                returns.push(if applied { 0xFF } else { 0x05 });
                datum_offset += 4 + byte_count;
                // Odd-length data items are padded except after the last one.
                if index + 1 != parsed.len() && (4 + byte_count) % 2 == 1 {
                    datum_offset += 1;
                }
            }
            let data_len = u16::try_from(returns.len()).expect("returns fit");
            Some(frame_from(
                &cotp,
                &ack_header(pdu_reference, 2, data_len),
                &[0x05, item_count],
                &returns,
            ))
        }
        _ => None,
    }
}
