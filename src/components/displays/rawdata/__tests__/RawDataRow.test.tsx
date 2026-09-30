import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  RAWDATA_LINE_MAX_BYTES,
  RawDataBuffer,
  type RawDataLineSource,
  type RawDataLineView,
} from '../../../../lib/buffers/dataBuffer';
import type { RawDataBatch } from '../../../../types';
import { Row } from '../RawDataRow';

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
});

function createBuffer(bytes: number[], continued = false): RawDataLineSource {
  const line: RawDataLineView = {
    offset: 0,
    timestamp: 0,
    direction: 'rx',
    bytes: Uint8Array.from(bytes),
    continued,
  };

  return {
    lineCount: 1,
    newlineLineCount: 1,
    totalBytes: bytes.length,
    droppedBytes: 0,
    getLine: () => line,
    getNewlineLine: () => line,
    subscribe: () => () => { return undefined; },
    clear: () => { return undefined; },
  };
}

describe('RawDataRow', () => {
  it.each(['ascii', 'hex'] as const)('preserves an ASCII space in %s view', (repr) => {
    const { container } = render(
      <Row
        originalIndex={0}
        filteredIndex={0}
        grouping="line"
        repr={repr}
        buffer={createBuffer([0x41, 0x20, 0x42])}
        showTimestamp={false}
        showOffset={false}
        hexColorMode="none"
        isSelected={false}
        version={1}
        lang="zh"
        onMouseDown={vi.fn()}
      />
    );

    const spaceCell = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === ' '
    );

    expect(spaceCell).toHaveClass('whitespace-pre');
  });

  it('marks a wrapped continuation row with ↳ instead of the direction arrow', () => {
    const { container, rerender } = render(
      <Row
        originalIndex={1}
        filteredIndex={1}
        grouping="line"
        repr="ascii"
        buffer={createBuffer([0x42], true)}
        showTimestamp={false}
        showOffset={false}
        hexColorMode="none"
        isSelected={false}
        version={1}
        lang="en"
        onMouseDown={vi.fn()}
      />
    );

    expect(container.textContent).toContain('↳');
    expect(container.textContent).not.toContain('↓');

    rerender(
      <Row
        originalIndex={1}
        filteredIndex={1}
        grouping="line"
        repr="ascii"
        buffer={createBuffer([0x42], false)}
        showTimestamp={false}
        showOffset={false}
        hexColorMode="none"
        isSelected={false}
        version={1}
        lang="en"
        onMouseDown={vi.fn()}
      />
    );

    expect(container.textContent).toContain('↓');
    expect(container.textContent).not.toContain('↳');
  });

  it('bounds the cell count of one row for a large newline-free stream', () => {
    // 64KB 无换行字节流: 折行前整段落在一行内, 每字节 2 个 cell → 131072 个 span 卡死渲染
    const buffer = new RawDataBuffer(1 << 20);
    const bytes = Array.from({ length: 65_536 }, () => 0x41);
    const batch: RawDataBatch = {
      seq: 0,
      chunks: [{ timestamp_us: 1_000, bytes_b64: btoa(String.fromCharCode(...bytes)) }],
      total_bytes: bytes.length,
      dropped_bytes: 0,
    };
    buffer.pushBatch(batch);

    const { container } = render(
      <Row
        originalIndex={0}
        filteredIndex={0}
        grouping="line"
        repr="hex"
        buffer={buffer}
        showTimestamp
        showOffset={false}
        hexColorMode="none"
        isSelected={false}
        version={1}
        lang="en"
        onMouseDown={vi.fn()}
      />
    );

    // hex 列 + ascii 列, 每行至多 2 × 单行上限个 cell
    expect(container.querySelectorAll('[data-present="true"]')).toHaveLength(
      RAWDATA_LINE_MAX_BYTES * 2
    );
    // 后续行继续承载余下字节, 数据没有丢失
    expect(buffer.newlineLineCount).toBe(65_536 / RAWDATA_LINE_MAX_BYTES);
    expect(buffer.getNewlineLine(1).continued).toBe(true);
  });
});
