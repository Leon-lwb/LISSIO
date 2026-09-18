//! Web 出口 — HTTP-RPC + WebSocket 实现。
//!
//! 线协议见 [web-exit.md](../../../docs/architecture/web-exit.md) §3:
//! 命令走 `POST /api/v1/rpc`, 事件与显示流走 `GET /api/v1/ws`。命令名、参数、
//! 错误 `kind`、事件名与 payload 与桌面 IPC 逐字一致 — 这里只负责搬运。
//!
//! 三个必须留意的协议细节:
//! 1. 订阅 **不带 id**: 服务端在进程级命名空间分配并通过 `subscribed` 回执下发。
//!    回执与流帧共用同一条出站队列, 因此"先回执后流帧"是有保证的, 不需要握手超时;
//!    但这也意味着回执与请求只能靠**顺序**配对 — `awaiting` 队列必须与 subscribe
//!    帧的发送顺序一致, 取消时也不能把它摘掉 (否则后续回执会错配到下一条订阅)。
//! 2. 二进制流帧头部固定 10 字节, payload 与桌面 IPC 的 `Raw` 逐字节相同,
//!    因此 WWB1 / VNDP / VENV 不需要重编码, 现有解码器无需按宿主分支。
//! 3. 令牌不进 URL: HTTP 用 `Authorization: Bearer`, WS 用子协议 `bearer.<token>`
//!    (浏览器的 WebSocket API 无法设置请求头)。

import type {
  EventChannel,
  RpcError,
  ServerNotification,
  SubscribeOptions,
  SubscriptionHandle,
  Transport,
} from './types';

/// 二进制流帧头部布局 — `[u8 version][u8 format][u32 BE 订阅 id][u32 BE payload 长度]`
const BINARY_FRAME_VERSION = 1;
const BINARY_FRAME_HEADER = 10;

/// WS 子协议 — 服务端只接受 `lissio.v2`, 令牌作为第二个提议值携带。
const WS_PROTOCOL = 'lissio.v2';
const WS_TOKEN_PREFIX = 'bearer.';

/// 重连退避: 首次 500ms, 逐次倍增, 上限 8s。
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;

/// Web 出口端点。
export interface WebEndpoint {
  /// 站点根 (无尾斜杠), 例如 `http://127.0.0.1:8790`。
  base: string;
  /// Bearer 令牌; 空串 = 不带鉴权 (仅本地调试)。
  token: string;
}

/// 从 `Content-Disposition` 还原服务端建议的文件名
/// (`attachment; filename="waveform.csv"`); 缺失或为空时返回 null。
export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim();
  // 空白文件名按"没有建议名"处理, 回落到调用方给的名字
  if (name === undefined || name === '') return null;
  return name;
}

/// 用临时对象 URL 触发浏览器保存 — 导出产物交付的收尾一步。
function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立即回收会让部分浏览器拿不到数据 — 下一轮事件循环再释放。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/// 服务端 → 客户端消息 (仅本出口消费的变体)。
interface SubscribedMessage {
  type: 'subscribed';
  id: number;
}
interface StreamMessage {
  type: 'stream';
  id: number;
  payload: unknown;
}
interface EventMessage {
  type: 'event';
  event: string;
  payload: unknown;
}
interface NotifyMessage {
  type: 'notify';
  level: string;
  message: string;
  /// 产物下载链接 (相对当前服务源); 只有导出类通知携带。
  url?: string | null;
}
interface FaultMessage {
  type: 'fault';
  message: string;
  /// 订阅建立失败时带上的订阅 id — 用于把失败归到具体订阅。
  id?: number | null;
}
interface ChannelMessage {
  type: 'channel';
  id: number;
  payload: unknown;
}
interface ResponseMessage {
  type: 'response';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: unknown;
}
type ServerMessage =
  | SubscribedMessage
  | StreamMessage
  | EventMessage
  | NotifyMessage
  | FaultMessage
  | ChannelMessage
  | ResponseMessage
  | { type: string };

interface WebEventChannel<T> extends EventChannel<T> {
  $channel: number;
}

/// 一条已登记或待回执的显示订阅。
interface SubscriptionRecord {
  request: unknown;
  options: SubscribeOptions | undefined;
  sink: (payload: unknown) => void;
  /// 服务端分配的 id; 回执到达前为 null。
  id: number | null;
  /// 取消后置 false — 记录仍可能留在 `awaiting` 里占位。
  live: boolean;
  /// 建立过程结束 (成功或失败) — 供订阅方做生命周期对账。
  settle: () => void;
}

/// 一条待提交的 HTTP-RPC 调用。
interface PendingCall {
  id: number;
  cmd: string;
  args: Record<string, unknown> | undefined;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/// 构造 Web 出口的调用失败 — 形状与后端 `RpcError` 的序列化一致。
function rpcFailure(kind: string, message: string): RpcError {
  return { kind, message };
}

/// 把任意抛出物归一为 Error。
///
/// `ensureSocket` 的拒绝只用于日志与"是否连上"的判定, 不进结构化错误契约
/// (只有命令失败才需要 `{kind, message}`), 因此这里用真正的 Error。
function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/// 从数组里删除一项 (就地, 保持顺序)。
function drop<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
}

export class HttpTransport implements Transport {
  readonly kind = 'http';

  private readonly endpoint: WebEndpoint;
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private closed = false;
  /// 是否已经成功连接过 — 用于区分首次连接与断线重连。
  private connectedOnce = false;

  private nextCallId = 1;
  private nextChannelId = 1;
  private batch: PendingCall[] = [];
  private batchScheduled = false;

  /// 全部活跃订阅 (按建立顺序) — 重连后按此顺序重新订阅。
  private readonly live: SubscriptionRecord[] = [];
  /// 已发出 subscribe 帧、等待 `subscribed` 回执的订阅 (FIFO)。
  private readonly awaiting: SubscriptionRecord[] = [];
  /// 服务端 id → 订阅 — 流帧分流的依据。
  private readonly established = new Map<number, SubscriptionRecord>();

  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly reconnectHandlers = new Set<() => void>();
  private readonly serverNotifyHandlers = new Set<(notification: ServerNotification) => void>();
  private readonly eventChannels = new Map<number, WebEventChannel<unknown>>();
  private readonly socketCalls = new Map<number, PendingCall>();

  constructor(endpoint: WebEndpoint) {
    this.endpoint = endpoint;
  }

  // ===== Transport =====

  call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (args && Object.values(args).some((value) => isWebEventChannel(value))) {
      return this.callOverSocket<T>(cmd, args);
    }
    return new Promise<T>((resolve, reject) => {
      this.batch.push({
        id: this.nextCallId++,
        cmd,
        args,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      // 同一微任务内发出的命令合成一个数组请求 — 启动突发与 ack_data 背压
      // 反馈都是这种形态, 合并后显著减少往返。
      if (!this.batchScheduled) {
        this.batchScheduled = true;
        queueMicrotask(() => {
          this.batchScheduled = false;
          void this.flush();
        });
      }
    });
  }

  async listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    const entry = handler as (payload: unknown) => void;
    handlers.add(entry);
    const unlisten = () => {
      handlers.delete(entry);
      if (handlers.size === 0) this.listeners.delete(event);
    };
    try {
      await this.ensureSocket();
    } catch (error) {
      // 连接失败不抛出: 事件监听是可选能力, 应用应照常启动; 重连成功后
      // 监听表仍在, 事件自然恢复。
      console.warn(`[web] 事件通道未就绪 (${event}):`, error);
    }
    return unlisten;
  }

  eventChannel<T>(): EventChannel<T> {
    const id = this.nextChannelId++;
    const channel: WebEventChannel<T> = { $channel: id, onmessage: null };
    this.eventChannels.set(id, channel as WebEventChannel<unknown>);
    return channel;
  }

  subscribe<T>(
    request: unknown,
    sink: (payload: T) => void,
    options?: SubscribeOptions,
  ): SubscriptionHandle {
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const record: SubscriptionRecord = {
      request,
      options,
      sink: sink as (payload: unknown) => void,
      id: null,
      live: true,
      settle,
    };
    this.live.push(record);
    if (this.isOpen()) {
      this.openSubscription(record);
    } else {
      // 连接建立后由 handleOpen 按 live 顺序统一补发 — 这里不补发, 否则会重复订阅。
      void this.ensureSocket().catch(() => undefined);
    }
    return {
      get id() {
        return record.id;
      },
      settled,
      cancel: () => this.cancelSubscription(record),
    };
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  onServerNotify(handler: (notification: ServerNotification) => void): () => void {
    this.serverNotifyHandlers.add(handler);
    return () => this.serverNotifyHandlers.delete(handler);
  }

  /// 取回导出产物并触发浏览器保存。
  ///
  /// 用带 `Authorization` 的 `fetch` 而不是直接导航到该 URL: 浏览器无法在导航
  /// 请求上附加请求头, 把令牌放进查询串则会写进访问日志与浏览器历史 (§3.5)。
  async downloadFile(relativeUrl: string, fallbackName: string): Promise<void> {
    const response = await fetch(`${this.endpoint.base}${relativeUrl}`, {
      headers: { ...this.authHeader() },
    });
    if (!response.ok) {
      throw new Error(`下载失败: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const fileName =
      fileNameFromDisposition(response.headers.get('content-disposition')) ?? fallbackName;
    triggerBrowserDownload(blob, fileName);
  }

  /// 断开并停止重连 (测试与卸载用)。
  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
    // 不会再有回执 — 让等待中的订阅方结束对账, 不留悬挂的 settled。
    for (const record of [...this.live, ...this.awaiting]) record.settle();
    this.live.length = 0;
    this.awaiting.length = 0;
    this.established.clear();
    for (const call of this.socketCalls.values()) {
      call.reject(new Error('Web 出口连接已关闭'));
    }
    this.socketCalls.clear();
    this.eventChannels.clear();
  }

  /** 当前端点 — 诊断用。 */
  get endpointBase(): string {
    return this.endpoint.base;
  }

  // ===== HTTP-RPC =====

  private callOverSocket<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const call: PendingCall = {
        id: this.nextCallId++, cmd, args,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.socketCalls.set(call.id, call);
      void this.ensureSocket().then(() => {
        this.socket?.send(JSON.stringify({ type: 'rpc', id: call.id, cmd, args }));
      }).catch((error: unknown) => {
        this.socketCalls.delete(call.id);
        reject(toError(error));
      });
    });
  }

  /// 提交已合并的调用。数组形态是协议的既定批量入口 (单条也走数组, 只有一种
  /// 请求/响应形状要维护)。
  private async flush(): Promise<void> {
    const pending = this.batch.splice(0, this.batch.length);
    if (pending.length === 0) return;
    let responses: unknown;
    try {
      const response = await fetch(`${this.endpoint.base}/api/v1/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.authHeader(),
        },
        body: JSON.stringify(
          pending.map((call) => ({
            id: call.id,
            cmd: call.cmd,
            args: call.args ?? {},
          })),
        ),
      });
      if (!response.ok) {
        this.rejectAll(pending, await this.failureFromResponse(response));
        return;
      }
      responses = await response.json();
    } catch (error) {
      this.rejectAll(pending, error);
      return;
    }
    const list = Array.isArray(responses) ? responses : [responses];
    if (list.length !== pending.length) {
      this.rejectAll(
        pending,
        rpcFailure(
          'InvalidResponse',
          `HTTP-RPC 响应数量不符: 请求 ${pending.length} 条, 响应 ${list.length} 条`,
        ),
      );
      return;
    }
    list.forEach((item, index) => this.settle(pending[index], item));
  }

  private settle(call: PendingCall, response: unknown): void {
    if (response && typeof response === 'object' && 'ok' in response) {
      const envelope = response as { ok: boolean; result?: unknown; error?: unknown };
      if (envelope.ok) {
        call.resolve(envelope.result);
        return;
      }
      call.reject(envelope.error ?? rpcFailure('Unknown', 'HTTP-RPC 调用失败'));
      return;
    }
    call.reject(rpcFailure('InvalidResponse', 'HTTP-RPC 响应形状不符'));
  }

  private rejectAll(pending: PendingCall[], error: unknown): void {
    for (const call of pending) call.reject(error);
  }

  /// 非 2xx 响应体带的是与 RPC 同形的错误信封 (401 = Unauthorized)。
  private async failureFromResponse(response: Response): Promise<RpcError> {
    try {
      const body = (await response.json()) as { error?: RpcError };
      if (body?.error?.kind) return body.error;
    } catch {
      // 非 JSON 响应体 (代理/网关) — 退化为状态码描述
    }
    return rpcFailure('HttpStatus', `HTTP ${response.status} ${response.statusText}`);
  }

  private authHeader(): Record<string, string> {
    return this.endpoint.token ? { authorization: `Bearer ${this.endpoint.token}` } : {};
  }

  // ===== WebSocket =====

  private isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private ensureSocket(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Web 出口连接已关闭'));
    }
    if (this.isOpen()) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.socketUrl(), this.subprotocols());
      } catch (error) {
        this.connecting = null;
        this.scheduleReconnect();
        reject(toError(error));
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        this.connecting = null;
        this.handleOpen();
        resolve();
      };
      socket.onmessage = (event: MessageEvent) => this.handleMessage(event);
      socket.onerror = () => {
        // 具体原因由紧随其后的 close 事件给出 — 这里不重复上报。
      };
      socket.onclose = () => {
        this.socket = null;
        this.connecting = null;
        const failure = rpcFailure('ConnectionLost', 'WebSocket 连接已断开');
        for (const call of this.socketCalls.values()) call.reject(failure);
        this.socketCalls.clear();
        // 已经 resolve 时是空操作; 未打开就关闭则让等待方感知失败。
        reject(new Error('Web 出口连接已关闭 (未能建立或已断开)'));
        this.scheduleReconnect();
      };
    });
    return this.connecting;
  }

  private handleOpen(): void {
    const isReconnect = this.connectedOnce;
    this.connectedOnce = true;
    this.reconnectDelay = RECONNECT_BASE_MS;
    // 旧连接上的订阅在服务端已随断连注销, 这里按原顺序重新订阅。
    this.awaiting.length = 0;
    this.established.clear();
    for (const record of this.live) {
      record.id = null;
      this.openSubscription(record);
    }
    if (isReconnect) {
      for (const handler of this.reconnectHandlers) handler();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureSocket().catch(() => undefined);
    }, delay);
  }

  private socketUrl(): string {
    const url = new URL(`${this.endpoint.base}/api/v1/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  private subprotocols(): string[] {
    return this.endpoint.token
      ? [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${this.endpoint.token}`]
      : [WS_PROTOCOL];
  }

  private handleMessage(event: MessageEvent): void {
    const data: unknown = event.data;
    if (typeof data === 'string') {
      this.handleText(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.handleBinary(data);
      return;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => this.handleBinary(buffer));
    }
  }

  private handleText(text: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(text) as ServerMessage;
    } catch (error) {
      console.warn('[web] 出口消息解析失败:', error);
      return;
    }
    switch (message.type) {
      case 'subscribed':
        this.handleSubscribed((message as SubscribedMessage).id);
        break;
      case 'stream': {
        const stream = message as StreamMessage;
        this.established.get(stream.id)?.sink(stream.payload);
        break;
      }
      case 'event': {
        const event = message as EventMessage;
        const handlers = this.listeners.get(event.event);
        if (!handlers) break;
        for (const handler of [...handlers]) handler(event.payload);
        break;
      }
      case 'channel': {
        const channel = message as ChannelMessage;
        this.eventChannels.get(channel.id)?.onmessage?.(channel.payload);
        if (isTerminalChannelPayload(channel.payload)) this.eventChannels.delete(channel.id);
        break;
      }
      case 'response': {
        const response = message as ResponseMessage;
        const call = this.socketCalls.get(response.id);
        if (!call) break;
        this.socketCalls.delete(response.id);
        if (response.ok) call.resolve(response.result);
        else call.reject(response.error ?? rpcFailure('Unknown', 'WebSocket RPC 调用失败'));
        break;
      }
      case 'notify': {
        const notify = message as NotifyMessage;
        // 应用内提示 (含导出下载链接) 由订阅方渲染 — transport 不认识 UI。
        const notification: ServerNotification = {
          level: notify.level,
          message: notify.message,
          url: notify.url ?? null,
        };
        if (this.serverNotifyHandlers.size === 0) {
          console.warn(`[web] 后端通知 (${notify.level}): ${notify.message}`);
          break;
        }
        for (const handler of [...this.serverNotifyHandlers]) handler(notification);
        break;
      }
      case 'fault':
        this.handleFault(message as FaultMessage);
        break;
      default:
        // `unsubscribed` / `response` 不需要处理: 取消是本地登记, 命令走 HTTP。
        break;
    }
  }

  private handleBinary(buffer: ArrayBuffer): void {
    if (buffer.byteLength < BINARY_FRAME_HEADER) {
      console.warn('[web] 二进制流帧过短:', buffer.byteLength);
      return;
    }
    const view = new DataView(buffer);
    if (view.getUint8(0) !== BINARY_FRAME_VERSION) {
      console.warn('[web] 二进制流帧版本不支持:', view.getUint8(0));
      return;
    }
    const id = view.getUint32(2, false);
    const length = view.getUint32(6, false);
    const end = BINARY_FRAME_HEADER + length;
    if (end > buffer.byteLength) {
      console.warn('[web] 二进制流帧长度越界:', length);
      return;
    }
    const record = this.established.get(id);
    if (!record) return;
    // 切出独立 ArrayBuffer: 上层解码器直接按偏移读数, 不能混入同帧的头部或后续字节。
    record.sink(buffer.slice(BINARY_FRAME_HEADER, end));
  }

  private handleSubscribed(id: number): void {
    // 回执与 subscribe 帧严格同序 (服务端在单条连接上顺序处理文本帧),
    // 因此这里只能按 FIFO 取; 取不到说明协议被破坏。
    const record = this.awaiting.shift();
    if (!record) {
      console.warn('[web] 收到无对应请求的订阅回执:', id);
      this.send({ type: 'unsubscribe', id });
      return;
    }
    if (!record.live) {
      // 回执到达前已被取消 — 记录留在队列里占位, 此处立即注销。
      this.send({ type: 'unsubscribe', id });
      record.settle();
      return;
    }
    record.id = id;
    this.established.set(id, record);
    record.settle();
  }

  private handleFault(message: FaultMessage): void {
    if (typeof message.id === 'number') {
      const record = this.established.get(message.id);
      if (record) {
        // 订阅建立失败 — 与桌面 IPC 的 invoke 拒绝同义, 交给订阅方降级。
        this.established.delete(message.id);
        this.forget(record);
        record.settle();
        record.options?.onError?.(rpcFailure('SubscribeFailed', message.message));
        return;
      }
    }
    console.warn(`[web] 出口协议错误: ${message.message}`);
  }

  private cancelSubscription(record: SubscriptionRecord): void {
    if (!record.live) return;
    record.live = false;
    drop(this.live, record);
    if (record.id !== null) {
      this.established.delete(record.id);
      this.send({ type: 'unsubscribe', id: record.id });
      return;
    }
    // 回执未到: 留在 `awaiting` 里占位, 否则后续回执会错配到下一条订阅。
  }

  private forget(record: SubscriptionRecord): void {
    record.live = false;
    drop(this.live, record);
    drop(this.awaiting, record);
  }

  /// 发出一条 subscribe 帧并把记录压入等待队列 — 两步必须紧邻,
  /// 才能保证队列顺序与服务端处理顺序 (即回执顺序) 完全一致。
  private openSubscription(record: SubscriptionRecord): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      // 连接不可用: 由 handleOpen 在连接建立后统一补发。
      return;
    }
    this.send({
      type: 'subscribe',
      args: {
        request: record.request,
        intervalMs: record.options?.intervalMs,
        maxItems: record.options?.maxItems,
      },
    });
    this.awaiting.push(record);
  }

  private send(frame: Record<string, unknown>): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }
}

function isTerminalChannelPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return false;
  const type = (payload as { type?: unknown }).type;
  return type === 'done' || type === 'cancelled' || type === 'error';
}

function isWebEventChannel(value: unknown): value is WebEventChannel<unknown> {
  return value !== null && typeof value === 'object' && '$channel' in value;
}

/// 按端点构造 Web 出口 transport。
export function createHttpTransport(endpoint: WebEndpoint): HttpTransport {
  return new HttpTransport(endpoint);
}
