//! HTTP-RPC calls, subscriptions, and the public Web transport facade.

import type {
  EventChannel,
  RpcError,
  SubscribeOptions,
  SubscriptionHandle,
  Transport,
} from './types';
import { HttpTransportConnection } from './httpTransportSocket';
export { fileNameFromDisposition } from './httpTransportProtocol';
export type { WebEndpoint } from './httpTransportProtocol';
import {
  fileNameFromDisposition,
  isWebEventChannel,
  rpcFailure,
  toError,
  triggerBrowserDownload,
  type PendingCall,
  type SubscriptionRecord,
  type WebEndpoint,
  type WebEventChannel,
} from './httpTransportProtocol';

export class HttpTransport extends HttpTransportConnection implements Transport {
  readonly kind = 'http';

  private nextCallId = 1;
  private nextChannelId = 1;
  private batch: PendingCall[] = [];
  private batchScheduled = false;

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

  protected callOverSocket<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
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
  protected async flush(): Promise<void> {
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

  protected settle(call: PendingCall, response: unknown): void {
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

  protected rejectAll(pending: PendingCall[], error: unknown): void {
    for (const call of pending) call.reject(error);
  }

  /// 非 2xx 响应体带的是与 RPC 同形的错误信封 (401 = Unauthorized)。
  protected async failureFromResponse(response: Response): Promise<RpcError> {
    try {
      const body = (await response.json()) as { error?: RpcError };
      if (body?.error?.kind) return body.error;
    } catch {
      // 非 JSON 响应体 (代理/网关) — 退化为状态码描述
    }
    return rpcFailure('HttpStatus', `HTTP ${response.status} ${response.statusText}`);
  }

  protected authHeader(): Record<string, string> {
    return this.endpoint.token ? { authorization: `Bearer ${this.endpoint.token}` } : {};
  }

}

export function createHttpTransport(endpoint: WebEndpoint): HttpTransport {
  return new HttpTransport(endpoint);
}
