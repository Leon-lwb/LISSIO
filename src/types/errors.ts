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

/// 面向用户的错误文案 — `RpcError { kind, message }` / Error / 字符串 统一取 message。
///
/// 出口拒绝的是**普通对象**而不是 Error (`lib/rpc/httpTransport.ts` 的 `rpcFailure`
/// 直接构造 `{ kind, message }`), 因此 `String(e)` 会把结构化错误渲染成
/// `[object Object]`; 对象分支必须先取 `message`, 缺失才退化为 JSON。
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  try {
    const json = JSON.stringify(e);
    // JSON.stringify(undefined) 返回 undefined — 不能当成文案
    if (typeof json === 'string') return json;
  } catch {
    // 循环引用等不可序列化的值 — 退化到 String
  }
  return String(e);
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
  return { kind: NodeErrorKind.Unknown, message: errorText(e) };
}
