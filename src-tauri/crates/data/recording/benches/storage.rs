#![allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]

use std::path::PathBuf;
use std::time::{Duration, Instant};

use recording::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, PortIdentity, RecordBatch, Recorder,
    RecordingLimits, RecordingStore,
};

fn binding(id: &str, domain: Domain) -> DisplayBinding {
    DisplayBinding {
        id: id.into(),
        component_id: format!("bench-{id}"),
        port: PortIdentity::new("bench-source", id),
        domain,
        capability: BindingCapability::Records,
    }
}

fn payload(domain: Domain, bytes: usize, random: bool) -> BatchPayload {
    match domain {
        Domain::Bytes => BatchPayload::Bytes {
            data: byte_data(bytes, random),
        },
        Domain::String => {
            let count = (bytes / 32).max(1);
            let values = (0..count)
                .map(|index| {
                    if random {
                        format!("event-{index:016x}-{:08x}", mix(index as u64))
                    } else {
                        "repeated acquisition event value".into()
                    }
                })
                .collect();
            BatchPayload::String { values }
        }
        Domain::Float => {
            let count = (bytes / 8).max(1);
            let values = (0..count)
                .map(|index| {
                    if random {
                        f64::from_bits((mix(index as u64) >> 12) | 0x3ff0_0000_0000_0000) - 1.0
                    } else {
                        ((index as f64) * 0.001).sin()
                    }
                })
                .collect();
            BatchPayload::Float { values }
        }
        Domain::Spectrum => {
            let count = (bytes / 16).max(1);
            let frequencies = (0..count).map(|index| index as f64 * 0.5).collect();
            let values = (0..count)
                .map(|index| {
                    if random {
                        (mix(index as u64) & 0xffff) as f64 / 65_535.0
                    } else {
                        1.0 / (index.saturating_add(1) as f64)
                    }
                })
                .collect();
            BatchPayload::Spectrum {
                frequencies,
                values,
            }
        }
    }
}

fn byte_data(bytes: usize, random: bool) -> Vec<u8> {
    (0..bytes)
        .map(|index| {
            if random {
                mix(index as u64) as u8
            } else {
                (index % 64) as u8
            }
        })
        .collect()
}

const fn mix(mut value: u64) -> u64 {
    value ^= value >> 12;
    value ^= value << 25;
    value ^= value >> 27;
    value.wrapping_mul(0x2545_f491_4f6c_dd1d)
}

fn timestamps(payload: &BatchPayload, base: u64) -> Vec<u64> {
    match payload {
        BatchPayload::Bytes { .. } | BatchPayload::Spectrum { .. } => vec![base],
        BatchPayload::String { values } => (0..values.len()).map(|n| base + n as u64).collect(),
        BatchPayload::Float { values } => (0..values.len()).map(|n| base + n as u64).collect(),
    }
}

fn run_case(batch_bytes: usize, total_bytes: usize, random: bool) -> serde_json::Value {
    let domains = [
        Domain::Bytes,
        Domain::String,
        Domain::Float,
        Domain::Spectrum,
    ];
    let bindings: Vec<_> = domains
        .iter()
        .enumerate()
        .map(|(index, domain)| binding(&format!("domain-{index}"), *domain))
        .collect();
    let templates: Vec<_> = domains
        .iter()
        .map(|domain| payload(*domain, batch_bytes, random))
        .collect();
    let path = database_path(batch_bytes, random);
    let _ = std::fs::remove_file(&path);
    let store = RecordingStore::open(&path).expect("open benchmark database");
    let recorder = Recorder::start(
        store.clone(),
        bindings,
        RecordingLimits {
            queue_batches: 1024,
            transaction_bytes: batch_bytes.saturating_mul(16).max(16 * 1024 * 1024),
            commit_interval_ms: 250,
        },
    )
    .expect("start recorder");
    let started = Instant::now();
    let mut accepted = 0_usize;
    let mut sequence = 0_u64;
    let mut backpressure = 0_u64;
    let mut max_queued_batches = 0_u64;
    let mut index = 0_usize;
    let target_bytes = total_bytes.max(batch_bytes.saturating_mul(domains.len()));
    while accepted < target_bytes {
        let template = &templates[index % templates.len()];
        let item_count =
            u64::try_from(template.item_count()).expect("benchmark item count fits u64");
        let batch = RecordBatch {
            binding_id: format!("domain-{}", index % domains.len()),
            epoch: 1,
            sequence_start: sequence,
            timestamps_us: timestamps(template, sequence),
            payload: template.clone(),
        };
        match recorder.append(batch) {
            Ok(()) => {
                accepted = accepted.saturating_add(template.effective_bytes());
                sequence = sequence.saturating_add(item_count);
                index += 1;
                max_queued_batches = max_queued_batches.max(recorder.health().queued_batches);
            }
            Err(recording::RecordingError::Backpressure) => {
                backpressure += 1;
                std::thread::sleep(Duration::from_micros(50));
            }
            Err(error) => panic!("append failed: {error}"),
        }
    }
    let flush_started = Instant::now();
    recorder.flush().expect("flush benchmark database");
    let flush_ms = flush_started.elapsed().as_secs_f64() * 1_000.0;
    let elapsed = started.elapsed();
    let health = recorder.health();
    assert_eq!(health.accepted_bytes, health.persisted_bytes);
    assert_eq!(health.accepted_batches, health.persisted_batches);
    let query_started = Instant::now();
    let query = store
        .query_sql(
            "SELECT domain, count(*) AS batches, sum(item_count) AS items, \
             sum(effective_bytes) AS bytes FROM recording_batches GROUP BY domain ORDER BY domain",
            100,
        )
        .expect("aggregate query");
    let query_ms = query_started.elapsed().as_secs_f64() * 1_000.0;
    let throughput = health.persisted_bytes as f64 / elapsed.as_secs_f64() / 1e6;
    recorder.shutdown().expect("stop recorder");
    let file_bytes = std::fs::metadata(&path).map_or(0, |metadata| metadata.len());
    let result = serde_json::json!({
        "backend": "duckdb",
        "batch_bytes": batch_bytes,
        "pattern": if random { "random" } else { "compressible" },
        "effective_bytes": health.persisted_bytes,
        "elapsed_s": elapsed.as_secs_f64(),
        "throughput_MB_s": throughput,
        "passes": {"100_MB_s": throughput >= 100.0, "250_MB_s": throughput >= 250.0, "500_MB_s": throughput >= 500.0},
        "flush_ms": flush_ms,
        "sql_visible_ms": query_ms,
        "max_queued_batches": max_queued_batches,
        "commit_and_queue_backpressure": backpressure,
        "accepted_sequence": health.accepted_sequence,
        "persisted_sequence": health.persisted_sequence,
        "database_bytes": file_bytes,
        "aggregate_query_ms": query_ms,
        "aggregate": query.rows,
        "complete": health.failed.is_none(),
    });
    let _ = std::fs::remove_file(path);
    result
}

fn database_path(batch_bytes: usize, random: bool) -> PathBuf {
    std::env::temp_dir().join(format!(
        "lissio-recording-bench-{}-{batch_bytes}.duckdb",
        if random { "random" } else { "signal" }
    ))
}

fn main() {
    let requested = std::env::var("VOFA_STORAGE_BENCH_BYTES").map_or(64 * 1024 * 1024, |value| {
        value.parse().expect("benchmark bytes")
    });
    let total_bytes = requested.min(4 * 1024 * 1024 * 1024_usize);
    assert!(total_bytes > 0);
    println!(
        "{}",
        serde_json::json!({
            "benchmark": "four_domain_recording",
            "duckdb_version": "1.5.5",
            "writer_model": "multi_producer_bounded_queue_single_database_writer",
            "total_effective_bytes_per_case": total_bytes,
            "machine": std::env::consts::ARCH,
            "short_run": true,
        })
    );
    for batch_bytes in [64 * 1024, 1024 * 1024, 4 * 1024 * 1024] {
        for random in [false, true] {
            println!("{}", run_case(batch_bytes, total_bytes, random));
        }
    }
}
