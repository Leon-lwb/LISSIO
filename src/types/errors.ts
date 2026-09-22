//! 节点错误类型 — 与后端 vofa_core Error 枚举一一对应
//!
//! 后端 Error 序列化为带标签结构 { kind, message } 跨 IPC 传递,
//! 前端用 parseNodeError 还原为可判别的 NodeError。

/// 节点错误种类 — 字符串值即后端 Error 枚举变体名
export enum NodeErrorKind {
  Transport = 'Transport',
  Protocol = 'Protocol',
  PortNotFound = 'PortNotFound',
  PortAlreadyOpen = 'PortAlreadyOpen',
  PortNotOpen = 'PortNotOpen',
  Io = 'Io',
  Config = 'Config',
  Serde = 'Serde',
  Automotive = 'Automotive',
  Graph = 'Graph',
  Plugin = 'Plugin',
  /// 兜底: 旧版纯字符串错误 / 未知 kind / 非后端错误
  Unknown = 'Unknown',
}

export interface NodeError {
  kind: NodeErrorKind;
  message: string;
}

const KNOWN_KINDS = new Set<string>(Object.values(NodeErrorKind));

/// RPC 出口会把后端错误压成纯字符串, kind 丢失; 按 serde 消息特征还原
/// 配置类错误 (如 `unknown variant \`Bps1M\`` / `missing field`), 让引导文案生效
const CONFIG_MESSAGE_PATTERNS = [
  /invalid driver configuration/i,
  /unknown variant/i,
  /missing field/i,
  /invalid type:/i,
  /invalid length:/i,
  /invalid value:/i,
];

function kindFromMessage(message: string): NodeErrorKind | null {
  return CONFIG_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
    ? NodeErrorKind.Config
    : null;
}

/// 将 IPC 错误值解析为 NodeError — 任何输入都不抛异常
export function parseNodeError(e: unknown): NodeError {
  if (e instanceof Error) return { kind: NodeErrorKind.Unknown, message: e.message };
  if (typeof e === 'string') {
    return { kind: kindFromMessage(e) ?? NodeErrorKind.Unknown, message: e };
  }
  if (e && typeof e === 'object') {
    const o = e as { kind?: unknown; message?: unknown };
    if (typeof o.message === 'string') {
      const kind =
        typeof o.kind === 'string' && KNOWN_KINDS.has(o.kind)
          ? (o.kind as NodeErrorKind)
          : (kindFromMessage(o.message) ?? NodeErrorKind.Unknown);
      return { kind, message: o.message };
    }
  }
  try {
    return { kind: NodeErrorKind.Unknown, message: JSON.stringify(e) };
  } catch {
    return { kind: NodeErrorKind.Unknown, message: String(e) };
  }
}
