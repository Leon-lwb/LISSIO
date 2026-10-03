import type { RawDataBatch, RawDataDirection } from '../../types';
import {
  RAWDATA_BYTES_PER_ROW,
  RAWDATA_LINE_MAX_BYTES,
  decodeBase64,
  type RawDataLineView,
} from './rawDataBufferModel';

export interface ChunkEntry {
  /// 该分片第一个字节在全局字节流中的偏移
  offset: number;
  /// 分片长度 (字节)
  length: number;
  /// 微秒时间戳
  timestamp_us: number;
  /// 数据方向
  direction: RawDataDirection;
}

/// 原始数据行读取接口 — RawDataView 渲染所需的最小契约
/// RawDataBuffer (全量) 与 FilteredRawDataBuffer (方向/搜索过滤) 均实现
export interface RawDataLineSource {
  /// 网格模式行数 (每 16 字节一行, 行边界与绝对字节流 16 字节对齐)
  readonly lineCount: number;
  /// 换行模式行数 (0x0A 分隔)
  readonly newlineLineCount: number;
  /// 获取网格模式指定行
  getLine(rowIndex: number): RawDataLineView;
  /// 获取换行模式指定行
  getNewlineLine(rowIndex: number): RawDataLineView;
  /// 累计字节数 (含已丢弃)
  readonly totalBytes: number;
  /// 累计丢弃字节数
  readonly droppedBytes: number;
  /// 订阅数据变化 (RAF 节流后触发)
  subscribe(fn: () => void): () => void;
  /// 清空视图 (过滤缓冲只清自身索引, 不影响源)
  clear(): void;
}

/// 原始数据缓冲区 — 基于 Uint8Array 的环形缓冲区
/// 接收来自后端 subscribe_data 统一入口 rawdata 通道的 RawDataBatch, RAF 节流后通知订阅者
export class RawDataBuffer {
  private buf: Uint8Array;
  private writePos = 0;
  private totalWritten = 0;
  private totalDropped = 0;
  private capacity: number;
  /// 分片索引, 按 offset 递增
  private chunks: ChunkEntry[] = [];
  private listeners = new Set<() => void>();
  private statsListeners = new Set<(usage: number, length: number, capacity: number) => void>();
  /// RAF 节流标志
  private rafScheduled = false;
  /// 脏标记: 本帧内是否有新数据
  private dirty = false;
  /// 换行索引: 每个元素的值为换行行的起始绝对流偏移 (0x0A 作为行末字节被包含)
  private lineStarts: number[] = [];
  /// 增量扫描已覆盖到的最大绝对偏移
  private lastScannedOffset = 0;
  /// 脏标记: 容量变更后需全量重建换行索引
  private lineIndexDirty = false;

  constructor(capacity = 1_048_576) {
    this.capacity = capacity;
    this.buf = new Uint8Array(capacity);
  }

  /// 批量推入原始数据 (base64 解码 + 环形块拷贝, 支持 7MB/s+ 吞吐)
  pushBatch(batch: RawDataBatch) {
    if (batch.chunks.length === 0 && batch.total_bytes === 0) return;
    this.totalDropped += batch.dropped_bytes ?? 0;
    for (const chunk of batch.chunks) {
      const bytes = decodeBase64(chunk.bytes_b64);
      const n = bytes.length;
      if (n === 0) continue;
      const startOffset = this.totalWritten;
      if (n >= this.capacity) {
        // 单块即超过容量: 只保留尾部 capacity 字节, 写满整个环
        this.buf.set(bytes.subarray(n - this.capacity), 0);
        this.writePos = 0;
        this.totalWritten += n;
      } else {
        const first = Math.min(n, this.capacity - this.writePos);
        this.buf.set(bytes.subarray(0, first), this.writePos);
        if (first < n) {
          this.buf.set(bytes.subarray(first), 0);
        }
        this.writePos = (this.writePos + n) % this.capacity;
        this.totalWritten += n;
      }
      this.chunks.push({
        offset: startOffset,
        length: n,
        timestamp_us: chunk.timestamp_us,
        direction: chunk.direction ?? 'rx',
      });
    }
    // 限制分片索引数量, 避免无限增长
    this.trimChunks();
    this.updateLineIndex();
    this.dirty = true;
    this.scheduleNotify();
  }

  /// 清理已被完全覆盖的分片元数据
  private trimChunks() {
    if (this.chunks.length <= 2000) return;
    const threshold = Math.max(0, this.totalWritten - this.capacity);
    let i = 0;
    while (i < this.chunks.length && this.chunks[i].offset + this.chunks[i].length <= threshold) {
      i++;
    }
    if (i > 0) {
      this.chunks = this.chunks.slice(i);
    }
  }

  /// 当前实际存储字节数
  get storedBytes(): number {
    return Math.min(this.totalWritten, this.capacity);
  }

  get capacityBytes(): number {
    return this.capacity;
  }

  /// 累计写入字节数 (绝对偏移空间; 最早保留偏移 = max(0, writtenTotal - storedBytes))
  get writtenTotal(): number {
    return this.totalWritten;
  }

  /// 分片元数据 (只读引用, 按 offset 递增) — 供过滤视图做增量索引
  /// 调用方不得修改返回数组及其元素
  getChunkEntries(): readonly ChunkEntry[] {
    return this.chunks;
  }

  /// 网格视图行起点 — 绝对字节流上按 RAWDATA_BYTES_PER_ROW 对齐 (保留窗口起点向上取整)。
  /// 必须按绝对流对齐, 不能直接用保留窗口起点: 环形回绕后每写入 1 字节窗口起点就前移
  /// 1 字节, 未对齐时分列会把所有可见行整体错位一列 —— 同一个绝对字节在相邻两帧落在
  /// 不同列上, 视口内容看起来就在闪烁。对齐后行内容是绝对的, 只在整行被淘汰时变化。
  get gridBaseOffset(): number {
    const retainedBase = Math.max(0, this.totalWritten - this.storedBytes);
    const aligned = Math.ceil(retainedBase / RAWDATA_BYTES_PER_ROW) * RAWDATA_BYTES_PER_ROW;
    // 保留窗口不足一整行 (容量 < 行宽) 时无对齐可谈: 退回窗口起点, 否则什么都显示不出来
    return aligned < this.totalWritten ? aligned : retainedBase;
  }

  /// 总行数 (每 16 字节一行, 自对齐后的行起点起算)
  get lineCount(): number {
    return Math.max(0, Math.ceil((this.totalWritten - this.gridBaseOffset) / RAWDATA_BYTES_PER_ROW));
  }

  /// 获取指定行视图 (不复制底层字节)
  getLine(rowIndex: number): RawDataLineView {
    const stored = this.storedBytes;
    // 保留窗口起点 (未对齐) — 仅用于绝对偏移到环形物理位置的换算
    const baseOffset = Math.max(0, this.totalWritten - stored);
    const lineStart = this.gridBaseOffset + rowIndex * RAWDATA_BYTES_PER_ROW;
    const lineEnd = Math.min(lineStart + RAWDATA_BYTES_PER_ROW, this.totalWritten);
    const length = Math.max(0, lineEnd - lineStart);

    // 对齐行起点最多比窗口起点大 RAWDATA_BYTES_PER_ROW - 1 字节, 仍落在窗口内
    const startPos = (this.writePos - stored + (lineStart - baseOffset) + this.capacity) % this.capacity;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = this.buf[(startPos + i) % this.capacity];
    }

    return {
      offset: lineStart,
      timestamp: this.getTimeForOffset(lineStart),
      direction: this.getDirectionForOffset(lineStart),
      bytes,
    };
  }

  /// 复制绝对偏移 [startOffset, endOffset) 区间的环形字节 (定位方式与 getLine 一致)
  /// 调用方需保证区间落在当前保留窗口内 (startOffset >= writtenTotal - storedBytes)
  readBytesAt(startOffset: number, endOffset: number): Uint8Array {
    const length = Math.max(0, endOffset - startOffset);
    const bytes = new Uint8Array(length);
    if (length === 0) return bytes;
    const stored = this.storedBytes;
    const baseOffset = Math.max(0, this.totalWritten - stored);
    const startPos = (this.writePos - stored + (startOffset - baseOffset) + this.capacity) % this.capacity;
    for (let i = 0; i < length; i++) {
      bytes[i] = this.buf[(startPos + i) % this.capacity];
    }
    return bytes;
  }

  /// 读取单个绝对偏移的字节; 落在保留窗口外返回 -1
  private byteAt(offset: number): number {
    const stored = this.storedBytes;
    const baseOffset = Math.max(0, this.totalWritten - stored);
    if (offset < baseOffset || offset >= this.totalWritten) return -1;
    return this.buf[(this.writePos - stored + (offset - baseOffset) + this.capacity) % this.capacity];
  }

  /// 增量维护换行/折行索引 — 只扫描新写入的字节 (pushBatch 后调用)
  private updateLineIndex() {
    const stored = this.storedBytes;
    const baseOffset = Math.max(0, this.totalWritten - stored);

    // 批量剔除被环形覆盖的行起点 — 一次 splice 而非逐个 shift (折行后行数可达上万)
    let expired = 0;
    while (expired < this.lineStarts.length && this.lineStarts[expired] < baseOffset) {
      expired++;
    }
    if (expired > 0) this.lineStarts.splice(0, expired);
    if (this.lineStarts.length === 0 || this.lineStarts[0] !== baseOffset) {
      this.lineStarts.unshift(baseOffset);
    }

    const scanStart = Math.max(this.lastScannedOffset, baseOffset);
    this.scanLineBreaks(scanStart, Math.max(0, this.totalWritten - scanStart));

    this.lastScannedOffset = this.totalWritten;
  }

  /// 扫描 [scanStart, scanStart + count) 的字节并追加行起点 —
  /// 0x0A 结束一行 (换行符含在行末), 行长达 RAWDATA_LINE_MAX_BYTES 处强制折行。
  /// 折行点回退到多字节字符起点, 保证每行都是完整的 UTF-8 序列。
  private scanLineBreaks(scanStart: number, count: number) {
    if (count <= 0) return;
    const stored = this.storedBytes;
    const baseOffset = Math.max(0, this.totalWritten - stored);
    const startPos = (this.writePos - stored + (scanStart - baseOffset) + this.capacity) % this.capacity;
    // 当前未闭合行的起点 = 最后一个已知行起点 (跨调用保持折行相位)
    let rowStart = this.lineStarts.length > 0 ? this.lineStarts[this.lineStarts.length - 1] : scanStart;
    for (let i = 0; i < count; i++) {
      const offset = scanStart + i;
      const byte = this.buf[(startPos + i) % this.capacity];
      if (byte === 0x0a) {
        rowStart = offset + 1;
        this.lineStarts.push(rowStart);
        continue;
      }
      if (offset - rowStart + 1 > RAWDATA_LINE_MAX_BYTES) {
        // 从本字节向前回退到所属 UTF-8 序列的首字节 (续字节形如 10xxxxxx)。
        // 序列最长 4 字节, 故最多回退 3 步; 再往前仍是续字节说明上游不是合法 UTF-8
        // (二进制流), 此时按上限硬折行 —— 否则会退化成每字节一行, 行数反而爆炸。
        let cut = offset;
        while (cut > offset - 3 && cut > rowStart + 1 && (this.byteAt(cut) & 0xc0) === 0x80) {
          cut--;
        }
        rowStart = cut;
        this.lineStarts.push(rowStart);
      }
    }
  }

  /// 全量重建换行/折行索引 (仅在容量变更后惰性调用)
  private rebuildLineIndex() {
    this.lineStarts = [];
    this.lineIndexDirty = false;
    const stored = this.storedBytes;
    const baseOffset = Math.max(0, this.totalWritten - stored);
    if (stored === 0) {
      this.lastScannedOffset = this.totalWritten;
      return;
    }
    this.lineStarts.push(baseOffset);
    this.scanLineBreaks(baseOffset, stored);
    this.lastScannedOffset = this.totalWritten;
  }

  /// 换行模式行数 (0x0A 分隔; 换行符作为行末字节, 空行计 1 行)
  get newlineLineCount(): number {
    if (this.lineIndexDirty) this.rebuildLineIndex();
    return this.lineStarts.length;
  }

  /// 获取换行模式下的指定行视图 (行跨 [lineStarts[i], lineStarts[i+1]))
  getNewlineLine(rowIndex: number): RawDataLineView {
    if (this.lineIndexDirty) this.rebuildLineIndex();
    if (rowIndex < 0 || rowIndex >= this.lineStarts.length) {
      return { offset: this.totalWritten, timestamp: this.getTimeForOffset(this.totalWritten), direction: 'rx', bytes: new Uint8Array(0) };
    }
    const start = this.lineStarts[rowIndex];
    const end = rowIndex + 1 < this.lineStarts.length ? this.lineStarts[rowIndex + 1] : this.totalWritten;
    // 行首前一字节不是 0x0A → 该行由单行上限折开 (行窗口外无法判定, 视为新行)
    const previous = this.byteAt(start - 1);
    return {
      offset: start,
      timestamp: this.getTimeForOffset(start),
      direction: this.getDirectionForOffset(start),
      bytes: this.readBytesAt(start, end),
      continued: previous !== -1 && previous !== 0x0a,
    };
  }

  /** 查找给定字节偏移对应的时间戳 (毫秒) */
  private getTimeForOffset(offset: number): number {
    if (this.chunks.length === 0) return 0;
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const chunk = this.chunks[mid];
      if (offset >= chunk.offset && offset < chunk.offset + chunk.length) {
        return Math.floor(chunk.timestamp_us / 1000);
      }
      if (offset < chunk.offset) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    // 未精确命中则返回最近的前一个分片时间戳
    let candidate = this.chunks[0];
    for (const chunk of this.chunks) {
      if (chunk.offset <= offset) candidate = chunk;
      else break;
    }
    return Math.floor(candidate.timestamp_us / 1000);
  }

  /** 查找给定字节偏移对应的数据方向 */
  private getDirectionForOffset(offset: number): RawDataDirection {
    if (this.chunks.length === 0) return 'rx';
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const chunk = this.chunks[mid];
      if (offset >= chunk.offset && offset < chunk.offset + chunk.length) {
        return chunk.direction;
      }
      if (offset < chunk.offset) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    // 未精确命中则返回最近的前一个分片方向
    let candidate = this.chunks[0];
    for (const chunk of this.chunks) {
      if (chunk.offset <= offset) candidate = chunk;
      else break;
    }
    return candidate.direction;
  }

  /// 累计字节数 (含已丢弃)
  get totalBytes(): number {
    return this.totalWritten + this.totalDropped;
  }

  /// 累计丢弃字节数
  get droppedBytes(): number {
    return this.totalDropped;
  }

  /// 设置容量并保留最近数据
  setCapacity(newCapacity: number) {
    const cap = Math.max(1, newCapacity);
    if (cap === this.capacity) return;

    // 若当前存储量超过新容量, 丢弃最旧块
    while (this.storedBytes > cap && this.chunks.length > 0) {
      const front = this.chunks.shift();
      if (front) {
        this.totalDropped += front.length;
      }
    }

    // 重建 Uint8Array 并拷贝已有数据 (保持最近字节在前)
    const newBuf = new Uint8Array(cap);
    const stored = Math.min(this.storedBytes, cap);
    if (stored > 0) {
      const startPos = (this.writePos - this.storedBytes + this.capacity) % this.capacity;
      const offset = this.storedBytes - stored;
      for (let i = 0; i < stored; i++) {
        newBuf[i] = this.buf[(startPos + offset + i) % this.capacity];
      }
    }
    this.buf = newBuf;
    this.writePos = stored % cap;
    this.totalWritten = stored;
    this.capacity = cap;
    this.lineIndexDirty = true;
    this.dirty = true;
    this.scheduleNotify();
  }

  clear() {
    this.buf.fill(0);
    this.writePos = 0;
    this.totalWritten = 0;
    this.totalDropped = 0;
    this.chunks = [];
    this.lineStarts = [];
    this.lastScannedOffset = 0;
    this.lineIndexDirty = false;
    this.dirty = true;
    this.scheduleNotify();
  }

  /// 订阅数据变化 (RAF 节流后触发, 无参数, 调用方自行读取行)
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /// 订阅缓存使用量统计, usage ∈ [0,1]
  subscribeStats(fn: (usage: number, length: number, capacity: number) => void): () => void {
    this.statsListeners.add(fn);
    fn(this.storedBytes / this.capacity, this.storedBytes, this.capacity);
    return () => this.statsListeners.delete(fn);
  }

  /// RAF 节流: 同一帧内多次 push 合并为一次通知
  private scheduleNotify() {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.flushNotify();
    });
  }

  private flushNotify() {
    if (!this.dirty) return;
    this.dirty = false;
    this.listeners.forEach((fn) => fn());

    const stored = this.storedBytes;
    const usage = stored / this.capacity;
    this.statsListeners.forEach((fn) => fn(usage, stored, this.capacity));
  }
}

export const rawDataBuffer = new RawDataBuffer();
