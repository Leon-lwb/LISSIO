//! 波形包络降采样 — 大窗口逐列 min/max 压缩 (GPU compute + CPU 参考)
//!
//! 「wgpu 预处理渲染波形, 前端只显示」论证结论的落地形态 (原型): 整帧像素
//! 流经 IPC 是负收益 (无零拷贝纹理共享 / 带宽超预算一个数量级 / 交互变
//! 往返), 而 GPU 擅长的逐点归约压缩 — N 点 → columns×(min, max, count) —
//! 让前端 uPlot 以缎带绘制全窗口包络, 数据量缩小 N/columns 倍。
//!
//! 数值约定:
//! - 列映射: `col(i) = floor((i + 0.5) * columns / n)` (f32 运算, CPU/GPU
//!   同式同精度 → 同列归属; 0.5 偏移让每列近似等宽)
//! - min/max 只统计非 NaN 样本; 空列 (无样本或全 NaN) min=+inf / max=-inf /
//!   count=0 — 前端按断线处理
//! - ±0 归一为 +0 (保序位键要求; 显示上 ±0 等同)
//! - GPU 原子 min/max 用有序浮点位键 (负数全位取反 / 非负仅翻符号位),
//!   与 CPU 线性扫描位级一致
//!
//! 原型边界: 每点两次全局原子操作, 未做 workgroup 内共享内存归约 —
//! 100k~4M 点量级已远超窗口推送预算, 进一步优化 (分层归约) 留待实测需要。

use crate::error::{GpuError, GpuResult};
use crate::pool::ReadbackStaging;

// 包络类型、列映射与 CPU 参考实现已下沉 L1 `waveform` (GPU 加速端口的
// 契约层); 此处再导出保持既有公共路径不变。
use waveform::Envelope;

/// 有序浮点位键 (编码) — 负数全位取反 / 非负仅翻符号位, 全域单调双射
///
/// NaN 必须先被排除; ±0 归一后 -0 不会进入本函数。解码用 [`decode_key`]。
const fn ordered_key(bits: u32) -> u32 {
    if bits & 0x8000_0000 != 0 {
        !bits
    } else {
        bits ^ 0x8000_0000
    }
}

/// 有序浮点位键 (解码) — [`ordered_key`] 的镜像: 编码后符号位为 0 表示原值
/// 为负 (全取反), 为 1 表示原值非负 (仅符号位被翻)
const fn decode_key(key: u32) -> u32 {
    if key & 0x8000_0000 != 0 {
        key ^ 0x8000_0000
    } else {
        !key
    }
}

const ENV_WGSL: &str = r"
struct Params {
    n: u32,
    columns: u32,
    scale: f32,
    pad: u32,
}

@group(0) @binding(0) var<storage, read> values: array<f32>;
@group(0) @binding(1) var<storage, read_write> acc_min: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> acc_max: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> acc_count: array<atomic<u32>>;
@group(0) @binding(4) var<uniform> params: Params;

fn ordered_key(bits: u32) -> u32 {
    return select(bits ^ 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) {
        return;
    }
    // NaN 位模式检测 — 不能用 `raw != raw` (Metal 快浮点会折叠为 false,
    // 见 git 历史 node_gpu/src/wgsl.rs 同款对策); 位运算不受快浮点影响
    let raw_bits = bitcast<u32>(values[i]);
    if ((raw_bits & 0x7f800000u) == 0x7f800000u && (raw_bits & 0x007fffffu) != 0u) {
        return;
    }
    let raw = values[i];
    let v = select(raw, 0.0, (raw_bits & 0x7fffffffu) == 0u); // ±0 位测试归一 (Metal 快浮点连 == 0.0 都不可靠)
    let col = min(u32(floor((f32(i) + 0.5) * params.scale)), params.columns - 1u);
    let key = ordered_key(bitcast<u32>(v));
    atomicMin(&acc_min[col], key);
    atomicMax(&acc_max[col], key);
    atomicAdd(&acc_count[col], 1u);
}
";

/// GPU uniform 参数 (scale 与 CPU 的 `columns as f32 / n as f32` 同式)
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    n: u32,
    columns: u32,
    scale: f32,
    pad: u32,
}

/// GPU 包络降采样 — N 点 → `columns`×(min, max, count)
///
/// 无适配器 / 设备失败时返回 `Err`, 调用方应回退 [`waveform::envelope_minmax_cpu`]。
// scale 的 usize→f32 截断是有意为之 (与 CPU 参考同式, 见模块注释)
#[allow(clippy::cast_precision_loss)]
pub fn envelope_minmax(
    ctx: &crate::GpuContext,
    values: &[f32],
    columns: usize,
) -> GpuResult<Envelope> {
    let device = ctx.device();
    if columns == 0 {
        return Err(GpuError::Map("columns 为 0".into()));
    }
    let n = values.len();
    let columns_u32 =
        u32::try_from(columns).map_err(|_| GpuError::Map("columns 超出 u32".into()))?;
    let n_u32 = u32::try_from(n).map_err(|_| GpuError::Map("样本数超出 u32".into()))?;

    // 输出缓冲 (映射期写初值 = 空列编码, 避免为一次性上传引入 util feature)
    let out_bytes = u64::from(columns_u32) * 4;
    let min_init = vec![ordered_key(0x7F80_0000); columns]; // key(+inf) = 0xFF80_0000
    let max_init = vec![ordered_key(0xFF80_0000); columns]; // key(-inf) = 0x007F_FFFF
    let make_out = |label: &'static str, init: &[u32]| {
        let buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: out_bytes.max(256),
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: true,
        });
        let mut view = buf
            .slice(..out_bytes)
            .get_mapped_range_mut()
            .expect("映射期写入应成功");
        view.copy_from_slice(bytemuck::cast_slice(init));
        drop(view);
        buf.unmap();
        buf
    };
    let min_buf = make_out("env-min", &min_init);
    let max_buf = make_out("env-max", &max_init);
    let count_buf = make_out("env-count", &vec![0u32; columns]);

    // 输入缓冲 (n = 0 时仍按 256 字节占位, kernel 越界守卫保证不读)
    let values_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("env-values"),
        size: (u64::try_from(n * 4).unwrap_or(0)).max(256),
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    if n > 0 {
        ctx.queue()
            .write_buffer(&values_buf, 0, bytemuck::cast_slice(values));
    }

    let params_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("env-params"),
        size: std::mem::size_of::<Params>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    ctx.queue().write_buffer(
        &params_buf,
        0,
        bytemuck::bytes_of(&Params {
            n: n_u32,
            columns: columns_u32,
            scale: columns as f32 / n.max(1) as f32,
            pad: 0,
        }),
    );

    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("env-wgsl"),
        source: wgpu::ShaderSource::Wgsl(ENV_WGSL.into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("env-pipeline"),
        layout: None,
        module: &module,
        entry_point: Some("main"),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });

    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("env-bind"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: values_buf.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: min_buf.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: max_buf.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: count_buf.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 4,
                resource: params_buf.as_entire_binding(),
            },
        ],
    });

    {
        // dispatch 独立提交 (wgpu 30 finish 拿走 encoder; 同队列提交序即执行序)
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("env-encoder"),
        });
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("env-pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        // n = 0 也 dispatch 1 组 (kernel 首行守卫返回; dispatch_workgroups 拒绝 0)
        pass.dispatch_workgroups(
            u32::try_from(n.div_ceil(256)).unwrap_or(u32::MAX).max(1),
            1,
            1,
        );
        drop(pass);
        ctx.queue().submit(Some(encoder.finish()));
    }

    let mut staging = ReadbackStaging::new(device);
    let read_out = |staging: &mut ReadbackStaging,
                    src: &wgpu::Buffer,
                    columns: usize|
     -> GpuResult<Vec<u32>> {
        let bytes = u64::try_from(columns * 4).unwrap_or(0);
        staging.ensure(bytes);
        let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("env-readback"),
        });
        staging.enqueue_copy(&mut enc, src, bytes);
        ctx.queue().submit(Some(enc.finish()));
        staging.map_blocking(device)?;
        let mut out = vec![0u32; columns];
        staging.read_u32(&mut out);
        staging.unmap();
        Ok(out)
    };
    let min_keys = read_out(&mut staging, &min_buf, columns)?;
    let max_keys = read_out(&mut staging, &max_buf, columns)?;
    let count = read_out(&mut staging, &count_buf, columns)?;

    // 有序键 → f32; 空列解码回 ±inf
    let decode = |keys: &[u32]| {
        keys.iter()
            .map(|&k| f32::from_bits(decode_key(k)))
            .collect()
    };
    Ok(Envelope {
        min: decode(&min_keys),
        max: decode(&max_keys),
        count,
    })
}

#[cfg(test)]
#[path = "envelope_tests.rs"]
mod tests;
