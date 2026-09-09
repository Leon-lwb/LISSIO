use criterion::{criterion_group, criterion_main, Criterion};
use modbus_adapter::{
    decode_registers, plan_reads, ByteOrder, ModbusArea, ModbusDataType, ModbusPoint, WordOrder,
};
use points::PointId;
use std::hint::black_box;

fn point(id: usize, address: u16, data_type: ModbusDataType) -> ModbusPoint {
    ModbusPoint {
        id: PointId(format!("point-{id}")),
        area: ModbusArea::HoldingRegisters,
        address,
        data_type,
        byte_order: ByteOrder::Big,
        word_order: WordOrder::Big,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    }
}

fn planner_benchmark(criterion: &mut Criterion) {
    let points: Vec<_> = (0..1_000)
        .map(|index| {
            point(
                index,
                u16::try_from(index * 2).unwrap(),
                ModbusDataType::U32,
            )
        })
        .collect();
    criterion.bench_function("modbus_plan_1000_contiguous_u32_points", |bencher| {
        bencher.iter(|| plan_reads(black_box(points.iter())).unwrap());
    });
}

fn codec_benchmark(criterion: &mut Criterion) {
    let point = point(0, 0, ModbusDataType::F64);
    let registers = [0x4009, 0x21fb, 0x5444, 0x2d18];
    criterion.bench_function("modbus_decode_f64_registers", |bencher| {
        bencher.iter(|| decode_registers(black_box(&point), black_box(&registers)).unwrap());
    });
}

criterion_group!(benches, planner_benchmark, codec_benchmark);
criterion_main!(benches);
