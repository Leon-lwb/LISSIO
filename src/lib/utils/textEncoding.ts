// ============ 文本编码解码工具 ============
//
// 显示层行字节 → 文本。按编码共享非流式 TextDecoder — decode() 无跨调用状态,
// 可安全复用; 非法序列替换为 U+FFFD。终端增量解析使用 createTextDecoder 的
// 独立实例，并通过 { stream: true } 保留跨分片状态。

export type TextEncoding = 'utf8' | 'gbk';

export function isTextEncoding(value: string): value is TextEncoding {
  return value === 'utf8' || value === 'gbk';
}

const sharedDecoders: Record<TextEncoding, TextDecoder> = {
  utf8: new TextDecoder('utf-8'),
  gbk: new TextDecoder('gbk'),
};

/// 创建独立增量解码器 (每个终端解析器持有自己的跨 feed 状态)
export function createTextDecoder(encoding: TextEncoding): TextDecoder {
  return new TextDecoder(encoding);
}

/// 按指定编码解码字节。网格模式 16 字节一行, 跨行断裂的多字节字符
/// 会在行界处显示为替换符 — 字节对齐视图的固有限制
export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  return sharedDecoders[encoding].decode(bytes);
}
