//! 适配器共享的连接配置 — 重连策略的唯一定义处。
//!
//! modbus 与 s7 两个 L4 适配器使用同一份 `reconnect` JSON 形状、同一退避公式
//! 与同一校验; 这里持有唯一实现, 适配器直接复用。

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// 重连退避配置
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectConfig {
    #[serde(default = "default_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_initial_delay_ms")]
    pub initial_delay_ms: u64,
    #[serde(default = "default_max_delay_ms")]
    pub max_delay_ms: u64,
}

const fn default_attempts() -> u32 {
    3
}

const fn default_initial_delay_ms() -> u64 {
    100
}

const fn default_max_delay_ms() -> u64 {
    2_000
}

impl Default for ReconnectConfig {
    fn default() -> Self {
        Self {
            max_attempts: default_attempts(),
            initial_delay_ms: default_initial_delay_ms(),
            max_delay_ms: default_max_delay_ms(),
        }
    }
}

impl ReconnectConfig {
    /// 第 `attempt` 次重连的退避间隔 — 指数增长, 上限 `max_delay_ms`
    #[must_use]
    pub fn delay(&self, attempt: u32) -> Duration {
        let factor = 1_u64
            .checked_shl(attempt.saturating_sub(1))
            .unwrap_or(u64::MAX);
        Duration::from_millis(
            self.initial_delay_ms
                .saturating_mul(factor)
                .min(self.max_delay_ms),
        )
    }

    /// 校验重连参数 — 初始延迟不得超过上限
    ///
    /// # Errors
    /// 参数越界时返回可读的错误说明。
    pub fn validate(&self) -> Result<(), String> {
        if self.initial_delay_ms > self.max_delay_ms {
            return Err("initial reconnect delay exceeds maximum".into());
        }
        Ok(())
    }
}

/// 第 `attempt` 次重连的退避间隔 (既有自由函数调用点)
#[must_use]
pub fn reconnect_delay(config: &ReconnectConfig, attempt: u32) -> Duration {
    config.delay(attempt)
}
