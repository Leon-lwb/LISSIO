//! 命令发送控件 (Command) 的帧工具 — 多帧归一化 / 帧增删改 / 端口派生 / 字节拼接

import { nanoid } from 'nanoid';
import type { CommandConfig, CommandFrame } from '../../types';

/// 取配置的帧列表 (frames 为空时返回空表)
export function getCommandFrames(params: CommandConfig): CommandFrame[] {
  return params.frames;
}

/// 收集所有帧的 var_ref 块输入端口名 (并集, 去重, 保序) — 节点输入 Handle 派生
export function commandInputPortNames(params: CommandConfig): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const frame of getCommandFrames(params)) {
    for (const b of frame.blocks) {
      if (b.type === 'var_ref' && b.portName && !seen.has(b.portName)) {
        seen.add(b.portName);
        names.push(b.portName);
      }
    }
  }
  return names;
}

/// 新空帧 (默认手动发送)
export function makeEmptyFrame(configId: string, label?: string): CommandFrame {
  return {
    id: `${configId || 'cmd'}-${nanoid(6)}`,
    label: label ?? 'Frame',
    blocks: [],
    appendNewline: false,
    sendMode: 'manual',
    timerMs: 100,
  };
}

/// 追加一帧
export function addCommandFrame(config: CommandConfig, frame: CommandFrame): CommandConfig {
  return { ...config, frames: [...config.frames, frame] };
}

/// 删除一帧 (至少保留一帧)
export function removeCommandFrame(config: CommandConfig, frameId: string): CommandConfig {
  if (config.frames.length <= 1) return config;
  return { ...config, frames: config.frames.filter((f) => f.id !== frameId) };
}

/// 更新指定帧的字段
export function updateCommandFrame(
  config: CommandConfig,
  frameId: string,
  changes: Partial<CommandFrame>
): CommandConfig {
  return {
    ...config,
    frames: config.frames.map((f) => (f.id === frameId ? { ...f, ...changes } : f)),
  };
}

/// 帧字节拼接结果
export interface ComputedFrame {
  bytes: Uint8Array | null;
  error: string | null;
  perBlock: Uint8Array[][];
}

/// 帧字节拼接已统一为 Rust 单一权威 (`schema_engine::compute_frame_bytes`):
/// 预览 (compute_command_frame_bytes) / 手动发送 (send_command_frame) /
/// 后台自动发送 (send_scheduler_ticker) 三路共用同一内核, 前端不做字节计算。
