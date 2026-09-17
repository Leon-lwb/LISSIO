//! 自动数据管道的安全上限。具体 worker、合批和推送速率由运行时控制器决定。

use serde::{Deserialize, Serialize};

/// 数值平面评估后端
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PipelineMode {
    #[default]
    Auto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PipelineConfig {
    pub mode: PipelineMode,
    pub max_workers: usize,
    /// 数值平面评估 worker 数 — ≥2 启用图内路径 (评估单元) 分块 fork-join
    /// 并行评估 (与串行路径逐位一致); 默认按 CPU 自动扩 (min(cores, 8)),
    /// 高采样率下全样本严格求值需要多 worker 才能跟上摄入
    pub eval_workers: usize,
    /// fork-join 并行路径内 Math 单元的 SciRS2 SIMD 批量求值开关
    /// (仅 eval_workers ≥ 2 生效; 结果与标量路径逐位一致)
    pub eval_simd: bool,
    pub memory_budget_mb: usize,
    pub preview_fps_limit: u32,
    pub preview_bandwidth_mb_per_sec: usize,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        // eval_workers 默认按 CPU 自动扩: 已保存的显式配置 (如 1 = 串行)
        // 经 serde 反序列化不受默认值影响
        let cores = std::thread::available_parallelism()
            .map_or(1, std::num::NonZero::get)
            .min(8);
        Self {
            mode: PipelineMode::Auto,
            max_workers: 8,
            eval_workers: cores.max(1),
            eval_simd: true,
            memory_budget_mb: 256,
            preview_fps_limit: 60,
            preview_bandwidth_mb_per_sec: 8,
        }
    }
}

impl PipelineConfig {
    /// 收敛到安全区间 — 调用方可提交任意值, 后端统一钳制。
    ///
    /// max_workers 1-64 / eval_workers 1-16 / memory 32-4096 MB /
    /// fps 1-120 / bandwidth 1-1024 MB/s。出口无关: 桌面 IPC 与 HTTP-RPC
    /// 提交的配置走同一份钳制, 避免两个出口对同一字段给出不同上限。
    #[must_use]
    pub fn sanitized(self) -> Self {
        Self {
            mode: self.mode,
            max_workers: self.max_workers.clamp(1, 64),
            eval_workers: self.eval_workers.clamp(1, 16),
            eval_simd: self.eval_simd,
            memory_budget_mb: self.memory_budget_mb.clamp(32, 4096),
            preview_fps_limit: self.preview_fps_limit.clamp(1, 120),
            preview_bandwidth_mb_per_sec: self.preview_bandwidth_mb_per_sec.clamp(1, 1024),
        }
    }
}
