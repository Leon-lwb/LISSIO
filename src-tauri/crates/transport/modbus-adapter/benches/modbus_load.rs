use acquisition::{
    AcquisitionRunState, DriverContext, ExecutionGate, SourceFactory, SourceSession, StateLane,
};
use data_model::device::{DriverId, DriverPayload};
use flow::SourceId;
use modbus_adapter::{
    ByteOrder, DRIVER_ID, ModbusArea, ModbusConfig, ModbusDataType, ModbusFactory, ModbusPoint,
    ReconnectConfig, SCHEMA_VERSION, WordOrder, decode_registers, plan_reads,
};
use points::{PointId, PointKey, PointQuality, PointSample, PointValue, ReadRequest};
use serde_json::json;
use std::hint::black_box;
use std::sync::Arc;
use std::time::Instant;

fn main() {
    let seconds = std::env::var("LISSIO_MODBUS_BENCH_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(2)
        .max(1);
    if std::env::var_os("LISSIO_MODBUS_BENCH_ONLY_SIMULATED").is_none() {
        for registers in [1_usize, 16, 64, 120] {
            for period_ms in [10_u64, 100, 1_000] {
                for devices in [1_usize, 8, 32] {
                    run_scenario(registers, period_ms, devices, seconds);
                }
            }
        }
    }
    simulated_service_benchmark();
    simulated_cancellation_benchmark();
}

#[allow(clippy::cast_precision_loss)]
fn run_scenario(registers: usize, period_ms: u64, devices: usize, seconds: u64) {
    let points = points(registers);
    let register_values: Vec<u16> = (0..registers)
        .map(|index| u16::try_from(index).unwrap_or(u16::MAX))
        .collect();
    let iterations = seconds
        .saturating_mul(1_000)
        .saturating_div(period_ms)
        .saturating_mul(devices as u64)
        .max(1);
    let lane = StateLane::new(
        registers.saturating_mul(devices).saturating_div(2).max(1),
        64 * 1024 * 1024,
    );
    let (pressure_tx, _pressure_rx) = tokio::sync::mpsc::channel::<usize>(64);
    let before = resource_usage();
    let started = Instant::now();
    let mut latencies = Vec::with_capacity(usize::try_from(iterations).unwrap_or_default());
    let mut backpressure = 0_u64;
    let mut decoded = 0_u64;

    for iteration in 0..iterations {
        let call = Instant::now();
        let plans = plan_reads(black_box(points.iter())).expect("valid read plan");
        for plan in plans {
            let values = &register_values
                [usize::from(plan.start)..usize::from(plan.start.saturating_add(plan.quantity))];
            for planned in plan.points {
                let point = &points[usize::from(planned.offset)];
                let value = decode_registers(point, &values[usize::from(planned.offset)..])
                    .expect("valid register value");
                let device = usize::try_from(iteration).unwrap_or(usize::MAX) % devices;
                let _ = lane.push(sample(device, point.id.clone(), value));
                decoded = decoded.saturating_add(1);
            }
        }
        if pressure_tx.try_send(registers).is_err() {
            backpressure = backpressure.saturating_add(1);
        }
        latencies.push(call.elapsed().as_secs_f64() * 1_000.0);
    }
    let wall = started.elapsed();
    let after = resource_usage();
    latencies.sort_by(f64::total_cmp);
    let lane_stats = lane.stats();
    let wall_seconds = wall.as_secs_f64().max(f64::EPSILON);
    println!(
        "{}",
        json!({
            "benchmark": "modbus_poll_load",
            "registers_per_batch": registers,
            "poll_period_ms": period_ms,
            "concurrent_devices": devices,
            "poll_cycles": iterations,
            "decoded_values": decoded,
            "throughput_values_per_second": decoded as f64 / wall_seconds,
            "latency_ms_p50": percentile(&latencies, 0.50),
            "latency_ms_p95": percentile(&latencies, 0.95),
            "latency_ms_p99": percentile(&latencies, 0.99),
            "cpu_seconds": after.cpu_seconds - before.cpu_seconds,
            "cpu_utilization_percent": ((after.cpu_seconds - before.cpu_seconds) / wall_seconds * 100.0),
            "resident_memory_delta_bytes": after.max_rss_bytes.saturating_sub(before.max_rss_bytes),
            "state_lane_estimated_bytes": lane_stats.estimated_bytes,
            "state_lane_overwritten": lane_stats.overwritten,
            "state_lane_evicted": lane_stats.evicted,
            "bounded_queue_backpressure": backpressure,
        })
    );
}

fn points(count: usize) -> Vec<ModbusPoint> {
    (0..count)
        .map(|index| ModbusPoint {
            id: PointId(format!("register-{index}")),
            area: ModbusArea::HoldingRegisters,
            address: u16::try_from(index).expect("scenario address fits u16"),
            data_type: ModbusDataType::U16,
            byte_order: ByteOrder::Big,
            word_order: WordOrder::Big,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        })
        .collect()
}

fn sample(device: usize, point_id: PointId, value: PointValue) -> PointSample {
    PointSample {
        key: PointKey {
            source_id: SourceId::new(format!("device-{device}")).expect("valid source id"),
            point_id,
        },
        value: Some(value),
        quality: PointQuality::GOOD,
        source_time_unix_ns: None,
        server_time_unix_ns: None,
        received_time_unix_ns: 0,
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss
)]
fn percentile(values: &[f64], percentile: f64) -> f64 {
    let index = ((values.len().saturating_sub(1)) as f64 * percentile).round() as usize;
    values.get(index).copied().unwrap_or_default()
}

#[allow(clippy::cast_precision_loss)]
fn simulated_service_benchmark() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("create benchmark runtime");
    runtime.block_on(async {
        for registers in [16_usize, 120] {
            for devices in [1_usize, 8, 32] {
                let mut sessions = Vec::with_capacity(devices);
                for device in 0..devices {
                    let port = spawn_modbus_service(false).await;
                    sessions.push(open_session(port, registers, device).await);
                }
                let before = resource_usage();
                let started = Instant::now();
                let mut tasks = tokio::task::JoinSet::new();
                for session in sessions {
                    let point_ids = points(registers)
                        .into_iter()
                        .map(|point| point.id)
                        .collect::<Vec<_>>();
                    tasks.spawn(async move {
                        let mut latencies = Vec::with_capacity(20);
                        for _ in 0..20 {
                            let call = Instant::now();
                            let result = session
                                .reader()
                                .expect("read capability")
                                .read(ReadRequest {
                                    points: point_ids.clone(),
                                })
                                .await
                                .expect("controlled service read");
                            black_box(result);
                            latencies.push(call.elapsed().as_secs_f64() * 1_000.0);
                        }
                        session.close().await.expect("close benchmark session");
                        latencies
                    });
                }
                let mut latencies = Vec::with_capacity(devices * 20);
                while let Some(result) = tasks.join_next().await {
                    latencies.extend(result.expect("benchmark task joins"));
                }
                let wall = started.elapsed();
                let after = resource_usage();
                latencies.sort_by(f64::total_cmp);
                let values = registers * devices * 20;
                println!(
                    "{}",
                    json!({
                        "benchmark": "modbus_tcp_simulated_service",
                        "registers_per_batch": registers,
                        "concurrent_devices": devices,
                        "requests_per_device": 20,
                        "throughput_values_per_second": values as f64 / wall.as_secs_f64(),
                        "latency_ms_p50": percentile(&latencies, 0.50),
                        "latency_ms_p95": percentile(&latencies, 0.95),
                        "latency_ms_p99": percentile(&latencies, 0.99),
                        "cpu_seconds": after.cpu_seconds - before.cpu_seconds,
                        "resident_memory_delta_bytes": after.max_rss_bytes.saturating_sub(before.max_rss_bytes),
                    })
                );
            }
        }
    });
}

fn simulated_cancellation_benchmark() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("create benchmark runtime");
    let latency = runtime.block_on(async {
        let port = spawn_modbus_service(true).await;
        let session = open_session(port, 1, 0).await;
        let reader = Arc::clone(&session);
        let request = tokio::spawn(async move {
            reader
                .reader()
                .expect("read capability")
                .read(ReadRequest {
                    points: vec![PointId("register-0".into())],
                })
                .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let started = Instant::now();
        session.close().await.expect("close benchmark session");
        request
            .await
            .expect("request task joins")
            .expect("read result");
        started.elapsed()
    });
    println!(
        "{}",
        json!({
            "benchmark": "modbus_tcp_simulated_cancel",
            "cancellation_latency_us": latency.as_secs_f64() * 1_000_000.0,
        })
    );
}

async fn open_session(port: u16, register_count: usize, device: usize) -> Arc<dyn SourceSession> {
    let config = ModbusConfig {
        host: "127.0.0.1".into(),
        port,
        unit_id: 1,
        timeout_ms: 2_000,
        reconnect: ReconnectConfig {
            max_attempts: 0,
            initial_delay_ms: 0,
            max_delay_ms: 0,
        },
        points: points(register_count),
    };
    let payload = DriverPayload {
        driver_id: DriverId(DRIVER_ID.into()),
        schema_version: SCHEMA_VERSION,
        payload: serde_json::to_value(config).expect("serialize benchmark config"),
    };
    let factory = ModbusFactory::default();
    let validated = factory
        .validate(&payload)
        .expect("validate benchmark config");
    let (state_sink, _) = tokio::sync::mpsc::channel(1);
    let (event_sink, _) = tokio::sync::mpsc::channel(1);
    factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new(format!("simulator-{device}")).expect("valid source id"),
                state_sink,
                event_sink,
                execution: ExecutionGate::new(AcquisitionRunState::Running),
            },
        )
        .await
        .expect("connect controlled service")
        .into()
}

async fn spawn_modbus_service(stall: bool) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind controlled Modbus service");
    let port = listener.local_addr().expect("service address").port();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept benchmark client");
        loop {
            let mut header = [0_u8; 7];
            if tokio::io::AsyncReadExt::read_exact(&mut stream, &mut header)
                .await
                .is_err()
            {
                break;
            }
            let pdu_len = usize::from(u16::from_be_bytes([header[4], header[5]])).saturating_sub(1);
            let mut request = vec![0_u8; pdu_len];
            if tokio::io::AsyncReadExt::read_exact(&mut stream, &mut request)
                .await
                .is_err()
            {
                break;
            }
            if stall {
                std::future::pending::<()>().await;
            }
            let quantity = u16::from_be_bytes([request[3], request[4]]);
            let byte_count = u8::try_from(quantity.saturating_mul(2)).expect("PDU limit");
            let response_len = 3_u16.saturating_add(u16::from(byte_count));
            let mut response = Vec::with_capacity(9 + usize::from(byte_count));
            response.extend_from_slice(&header[..4]);
            response.extend_from_slice(&response_len.to_be_bytes());
            response.push(header[6]);
            response.push(request[0]);
            response.push(byte_count);
            for value in 0..quantity {
                response.extend_from_slice(&value.to_be_bytes());
            }
            if tokio::io::AsyncWriteExt::write_all(&mut stream, &response)
                .await
                .is_err()
            {
                break;
            }
        }
    });
    port
}

#[derive(Clone, Copy, Default)]
struct ResourceUsage {
    cpu_seconds: f64,
    max_rss_bytes: u64,
}

#[cfg(unix)]
fn resource_usage() -> ResourceUsage {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: getrusage initializes the provided rusage when it returns zero.
    let status = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if status != 0 {
        return ResourceUsage::default();
    }
    // SAFETY: the successful getrusage call initialized every field.
    let usage = unsafe { usage.assume_init() };
    let cpu_seconds = timeval_seconds(usage.ru_utime) + timeval_seconds(usage.ru_stime);
    #[cfg(target_os = "macos")]
    let max_rss_bytes = u64::try_from(usage.ru_maxrss).unwrap_or_default();
    #[cfg(not(target_os = "macos"))]
    let max_rss_bytes = u64::try_from(usage.ru_maxrss)
        .unwrap_or_default()
        .saturating_mul(1_024);
    ResourceUsage {
        cpu_seconds,
        max_rss_bytes,
    }
}

#[cfg(unix)]
#[allow(clippy::cast_lossless, clippy::cast_precision_loss)]
fn timeval_seconds(value: libc::timeval) -> f64 {
    value.tv_sec as f64 + value.tv_usec as f64 / 1_000_000.0
}

#[cfg(not(unix))]
fn resource_usage() -> ResourceUsage {
    ResourceUsage::default()
}
