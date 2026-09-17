//! 出口无关的前端调用契约。
//!
//! 上层 (`lib/tauri/tauri.ts` 的 `api` 对象、各显示订阅模块、store) 只依赖
//! [`Transport`], 由 `index.ts` 按运行环境选择 Tauri IPC 或 HTTP/WS 实现 —
//! 命令名、参数、错误 `kind`、事件名与 payload 形状因此在两个出口完全一致,
//! 组件不需要按宿主分支。

/// 命令失败的结构化错误 — 与后端 `error::Error` 的序列化形状 `{ kind, message }`
/// 一致, 因此 `parseNodeError` / `errorGuidance` 对两个出口同样有效。
export interface RpcError {
  kind: string;
  message: string;
  data?: Record<string, string>;
}

/// 事件通道 — `ai_chat_send` 这类"命令内联回调流"的参数形状。
/// 桌面出口传 Tauri `Channel`; Web 出口不支持 (对应命令在 `/capabilities`
/// 中列为 `pending`), 构造时即抛结构化错误。
export interface EventChannel<T> {
  onmessage: ((value: T) => void) | null;
}

export interface SubscribeOptions {
  intervalMs?: number;
  /// 单次推送的最大条目数; `null`/缺省 = 不限制 (后端按窗口自适应)。
  maxItems?: number | null;
  /// 订阅建立失败 — 与桌面 IPC 的 `invoke('subscribe_data')` 拒绝同义。
  /// 两个出口都必须调用它, 否则订阅只在后台失败, 上层无从降级。
  onError?: (error: unknown) => void;
}

/// 一条显示订阅的句柄。
///
/// `id` 是后端订阅表里的键, `ack_data` 的背压反馈需要它:
/// - 桌面出口由 `Channel.id` 同步给出;
/// - Web 出口由服务端在 `subscribed` 回执里下发, 且回执必定先于该 id 的任何
///   流帧 (两者共用同一条出站队列), 因此流帧到达时它一定已经就绪。
export interface SubscriptionHandle {
  readonly id: number | null;
  /// 建立过程结束 — **成功与失败都会 resolve**, 失败详情只经 [`SubscribeOptions.onError`]
  /// 上报。订阅方据此做生命周期对账 (例如"在途建立结束后还要不要重订")。
  ///
  /// 之所以把失败单独拆开: Web 出口的回执先于订阅尝试下发 (回执要带上服务端分配的
  /// id), 因此"回执到达"不等于"订阅成功", 用同一个 promise 无法表达两件事。
  readonly settled: Promise<void>;
  /// 以属性而非方法声明 — 允许调用方解构/转交 (`{ cancel }`), 无需绑定 this。
  readonly cancel: () => void;
}

export interface Transport {
  /// 当前实现 — 诊断与测试用。
  readonly kind: 'tauri' | 'http';
  call<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /// 订阅后端事件; 返回注销函数。事件名与 `BackendEventSink::emit_event` 一致。
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  /// 构造命令内联事件通道 (`ai_chat_send`)。
  eventChannel<T>(): EventChannel<T>;
  /// 建立显示订阅 (对应 `subscribe_data`)。
  subscribe<T>(
    request: unknown,
    sink: (payload: T) => void,
    options?: SubscribeOptions,
  ): SubscriptionHandle;
  /// 断线重连成功后的回调 (仅 Web 出口触发; 首次连接不触发)。
  /// 上层据此重新水合权威状态, 返回注销函数。
  onReconnect?(handler: () => void): () => void;
}
