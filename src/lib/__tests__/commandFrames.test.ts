import { describe, expect, it } from 'vitest';
import {
  commandInputPortNames,
  addCommandFrame,
  removeCommandFrame,
  updateCommandFrame,
  makeEmptyFrame,
} from '../utils/commandFrames';
import type { CommandConfig } from '../../types';

describe('commandInputPortNames (全帧 var_ref 并集)', () => {
  it('多帧端口名取并集, 去重且保序', () => {
    const cfg: CommandConfig = {
      id: 'cmd-2',
      label: 'C',
      frames: [
        {
          id: 'f1', label: 'F1', appendNewline: false, sendMode: 'manual', timerMs: 100,
          blocks: [
            { id: 'a', type: 'var_ref', portName: 'speed', fieldType: 'uint16LE' },
            { id: 'b', type: 'var_ref', portName: 'dir', fieldType: 'uint8' },
          ],
        },
        {
          id: 'f2', label: 'F2', appendNewline: false, sendMode: 'manual', timerMs: 100,
          blocks: [
            { id: 'c', type: 'var_ref', portName: 'speed', fieldType: 'uint16LE' }, // 重复
            { id: 'd', type: 'var_ref', portName: 'temp', fieldType: 'int16LE' },
            { id: 'e', type: 'const_hex', hex: 'AA' }, // 非 var_ref 不计
          ],
        },
      ],
      loopbackEnabled: false,
      loopbackHistory: [],
    };
    expect(commandInputPortNames(cfg)).toEqual(['speed', 'dir', 'temp']);
  });

});

describe('帧增删改', () => {
  const base: CommandConfig = {
    id: 'cmd-legacy', label: 'Cmd', loopbackEnabled: false, loopbackHistory: [],
    frames: [{
      id: 'f0', label: 'F0', appendNewline: false, sendMode: 'manual', timerMs: 100,
      blocks: [{ id: 'b1', type: 'const_hex', hex: 'AA 01' }],
    }],
  };

  it('addCommandFrame 追加一帧', () => {
    const f2 = makeEmptyFrame('cmd-1', 'F2');
    const cfg = addCommandFrame(base, f2);
    expect(cfg.frames).toHaveLength(2);
    expect(cfg.frames[1]).toEqual(f2);
    // 原配置不被修改
    expect(base.frames).toHaveLength(1);
  });

  it('removeCommandFrame 删除指定帧, 但至少保留一帧', () => {
    const f2 = makeEmptyFrame('cmd-1', 'F2');
    const cfg = addCommandFrame(base, f2);
    const removed = removeCommandFrame(cfg, f2.id);
    expect(removed.frames).toHaveLength(1);
    expect(removed.frames[0].id).toBe(base.frames[0].id);
    // 只剩一帧时删除无效
    const kept = removeCommandFrame(removed, removed.frames[0].id);
    expect(kept.frames).toHaveLength(1);
  });

  it('updateCommandFrame 只改指定帧 (改名/触发模式)', () => {
    const f2 = makeEmptyFrame('cmd-1', 'F2');
    const cfg = addCommandFrame(base, f2);
    const renamed = updateCommandFrame(cfg, f2.id, { label: '停機', sendMode: 'onChange' });
    expect(renamed.frames[1].label).toBe('停機');
    expect(renamed.frames[1].sendMode).toBe('onChange');
    // 其他帧不受影响
    expect(renamed.frames[0]).toEqual(cfg.frames[0]);
  });
});

// 注: 帧字节拼接 (computeFrameBytes) 已统一为 Rust 单一权威
// (schema_engine::compute_frame_bytes, 见其 wire-shape/打包测试) —
// 预览 / 手动发送 / 后台自动发送三路共用同一内核, 前端不再实现字节计算。
