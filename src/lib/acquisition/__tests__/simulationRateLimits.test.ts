import { describe, expect, it } from 'vitest';
import {
  MAX_FRAME_RATE,
  MAX_SAMPLE_RATE,
  isFrameOrientedProtocol,
  maxSimulationRate,
  simulationRateUnit,
} from '../simulationRateLimits';

/**
 * 本模块是 Rust 常量的展示镜像, 数值本身必须被钉住 —— 漂移不会造成正确性问题
 * (校验权威在后端 `validate_for_protocol`), 但会让输入框给出错误的上界提示,
 * 把「按波特率折算帧率」这类量纲误用推迟到连接时才暴露。
 */
describe('模拟速率上限镜像', () => {
  it('与 Rust 常量同值', () => {
    expect(MAX_SAMPLE_RATE).toBe(5_000_000);
    expect(MAX_FRAME_RATE).toBe(20_000);
    expect(MAX_FRAME_RATE).toBeLessThan(MAX_SAMPLE_RATE);
  });

  it('只有每采样点产出一帧报文的协议是帧定界', () => {
    expect(isFrameOrientedProtocol('Slcan')).toBe(true);
    expect(isFrameOrientedProtocol('CandleLight')).toBe(true);
    // LogicDecode 每采样点只产出一个字节, 字节流速率与采样率同阶
    expect(isFrameOrientedProtocol('LogicDecode')).toBe(false);
    expect(isFrameOrientedProtocol('JustFloat')).toBe(false);
    expect(isFrameOrientedProtocol('FireWater')).toBe(false);
    expect(isFrameOrientedProtocol('RawData')).toBe(false);
    // 未选格式 / 未挂测试数据属性时不得报出帧率量纲
    expect(isFrameOrientedProtocol(null)).toBe(false);
    expect(isFrameOrientedProtocol(undefined)).toBe(false);
  });

  it('帧定界协议按帧率收窄上限并显式标注量纲', () => {
    expect(maxSimulationRate('Slcan')).toBe(MAX_FRAME_RATE);
    expect(simulationRateUnit('Slcan')).toBe('帧/秒');
    // 500k 波特率不是 500k 帧/秒 —— 该值必须被输入框挡住
    expect(MAX_FRAME_RATE).toBeLessThan(500_000);
  });

  it('流式协议使用采样率上限', () => {
    for (const kind of ['JustFloat', 'FireWater', 'RawData', 'LogicDecode', null]) {
      expect(maxSimulationRate(kind)).toBe(MAX_SAMPLE_RATE);
      expect(simulationRateUnit(kind)).toBe('采样/秒');
    }
  });
});
