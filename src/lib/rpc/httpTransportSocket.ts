//! Shared WebSocket connection lifecycle for the Web transport.

import {
  BINARY_FRAME_HEADER,
  BINARY_FRAME_VERSION,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  WS_PROTOCOL,
  WS_TOKEN_PREFIX,
  drop,
  isTerminalChannelPayload,
  rpcFailure,
  toError,
  type ChannelMessage,
  type EventMessage,
  type FaultMessage,
  type NotifyMessage,
  type PendingCall,
  type ResponseMessage,
  type ServerMessage,
  type StreamMessage,
  type SubscribedMessage,
  type SubscriptionRecord,
  type WebEndpoint,
  type WebEventChannel,
} from './httpTransportProtocol';
import type { ServerNotification } from './types';

export class HttpTransportConnection {
  protected readonly endpoint: WebEndpoint;
  protected socket: WebSocket | null = null;
  protected connecting: Promise<void> | null = null;
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectDelay = RECONNECT_BASE_MS;
  protected closed = false;
  /// 是否已经成功连接过 — 用于区分首次连接与断线重连。
  protected connectedOnce = false;

  /// 全部活跃订阅 (按建立顺序) — 重连后按此顺序重新订阅。
  protected readonly live: SubscriptionRecord[] = [];
  /// 已发出 subscribe 帧、等待 `subscribed` 回执的订阅 (FIFO)。
  protected readonly awaiting: SubscriptionRecord[] = [];
  /// 服务端 id → 订阅 — 流帧分流的依据。
  protected readonly established = new Map<number, SubscriptionRecord>();

  protected readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  protected readonly reconnectHandlers = new Set<() => void>();
  protected readonly serverNotifyHandlers = new Set<(notification: ServerNotification) => void>();
  protected readonly eventChannels = new Map<number, WebEventChannel<unknown>>();
  protected readonly socketCalls = new Map<number, PendingCall>();

  constructor(endpoint: WebEndpoint) {
    this.endpoint = endpoint;
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  onServerNotify(handler: (notification: ServerNotification) => void): () => void {
    this.serverNotifyHandlers.add(handler);
    return () => this.serverNotifyHandlers.delete(handler);
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

  protected isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  protected ensureSocket(): Promise<void> {
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

  protected handleOpen(): void {
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

  protected scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureSocket().catch(() => undefined);
    }, delay);
  }

  protected socketUrl(): string {
    const url = new URL(`${this.endpoint.base}/api/v1/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  protected subprotocols(): string[] {
    return this.endpoint.token
      ? [WS_PROTOCOL, `${WS_TOKEN_PREFIX}${this.endpoint.token}`]
      : [WS_PROTOCOL];
  }

  protected handleMessage(event: MessageEvent): void {
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

  protected handleText(text: string): void {
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

  protected handleBinary(buffer: ArrayBuffer): void {
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

  protected handleSubscribed(id: number): void {
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

  protected handleFault(message: FaultMessage): void {
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

  protected cancelSubscription(record: SubscriptionRecord): void {
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

  protected forget(record: SubscriptionRecord): void {
    record.live = false;
    drop(this.live, record);
    drop(this.awaiting, record);
  }

  /// 发出一条 subscribe 帧并把记录压入等待队列 — 两步必须紧邻,
  /// 才能保证队列顺序与服务端处理顺序 (即回执顺序) 完全一致。
  protected openSubscription(record: SubscriptionRecord): void {
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

  protected send(frame: Record<string, unknown>): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }
}
