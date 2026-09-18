// ============ UTF-8 解码工具 ============
//
// 显示层行字节 → 文本。共享单个 TextDecoder — 非流式 decode() 无跨调用状态,
// 可安全复用; 非法序列替换为 U+FFFD。

const sharedUtf8Decoder = new TextDecoder('utf-8');

/// 字节按 UTF-8 解码。网格模式 16 字节一行, 跨行断裂的多字节字符
/// 会在行界处显示为替换符 — 字节对齐视图的固有限制
export function decodeUtf8(bytes: Uint8Array): string {
  return sharedUtf8Decoder.decode(bytes);
}
