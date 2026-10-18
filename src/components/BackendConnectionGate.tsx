import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { writeTextToClipboard } from '../lib/utils/clipboard';
import { useModelCatalogStore } from '../store/modelCatalogStore';
import { invalidateDescriptions } from '../lib/models/describeStore';
import { revealMainWindow } from '../lib/startup/reveal';
import {
  configureBackend,
  disconnectBackend,
  hasTauriRuntime,
  normalizeBase,
  resolveWebEndpoint,
  saveWebEndpoint,
  transport,
} from '../lib/rpc';
import { errorText } from '../types/errors';
import { PROTOCOL_VERSION } from '../lib/rpc/httpTransportProtocol';

type ConnectionState =
  | 'starting' | 'checking' | 'connected' | 'unreachable'
  | 'unauthorized' | 'incompatible' | 'crashed';

interface SidecarInfo {
  status: 'starting' | 'running' | 'failed' | 'stopped';
  base: string | null;
  token: string | null;
  version: string;
  log_path: string | null;
  error: string | null;
}

interface Handshake {
  version: string;
  protocol: string;
}

/// 出口协议版本 — 与后端 `backend_server::frames::PROTOCOL_VERSION` 同源 (生成契约),
/// 本文件不重复字面量。
const EXPECTED_PROTOCOL = PROTOCOL_VERSION;

export function BackendConnectionGate({ children }: { children: ReactNode }) {
  const desktop = hasTauriRuntime();
  const initial = resolveWebEndpoint();
  const [base, setBase] = useState(initial.base);
  const [token, setToken] = useState(initial.token);
  const [state, setState] = useState<ConnectionState>('starting');
  const [detail, setDetail] = useState('正在查找后端服务…');
  const [logPath, setLogPath] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const initialCheckStarted = useRef(false);

  // 连接诊断页本身就是首屏的一部分 — 各失败分支立即放行主窗口/关闭启动页。
  // 放行实现全仓唯一 (`lib/startup/reveal`), 与业务树 (设置加载完成) 共用幂等闩;
  // Web 出口未接入窗口命令, reveal 内部对两个命令的失败静默。
  const showWindow = useCallback(() => {
    if (!desktop) return;
    revealMainWindow();
  }, [desktop]);

  const connect = useCallback(async (candidateBase: string, candidateToken: string, expectedVersion?: string) => {
    const normalized = normalizeBase(candidateBase);
    if (!normalized) {
      setState('unreachable');
      setDetail('服务器地址无效');
      showWindow();
      return;
    }
    // Keep the actual endpoint visible on the diagnostic page even when CORS, authentication,
    // or protocol negotiation fails before configureBackend can install the transport.
    setBase(normalized);
    setToken(candidateToken);
    setState('checking');
    setDetail(`正在连接 ${normalized}…`);
    try {
      const health = await fetch(`${normalized}/api/v1/health`);
      if (!health.ok) throw new Error(`健康检查返回 HTTP ${health.status}`);
      const response = await fetch(`${normalized}/api/v1/handshake`, {
        headers: candidateToken ? { authorization: `Bearer ${candidateToken}` } : {},
      });
      if (response.status === 401) {
        setState('unauthorized');
        setDetail('访问令牌无效或缺失');
        showWindow();
        return;
      }
      if (!response.ok) throw new Error(`握手返回 HTTP ${response.status}`);
      const handshake = await response.json() as Handshake;
      if (handshake.protocol !== EXPECTED_PROTOCOL) {
        setState('incompatible');
        setDetail(`协议不兼容：需要 ${EXPECTED_PROTOCOL}，后端为 ${handshake.protocol}`);
        showWindow();
        return;
      }
      if (expectedVersion && handshake.version !== expectedVersion) {
        setState('incompatible');
        setDetail(`Desktop ${expectedVersion} 与 sidecar ${handshake.version} 版本不一致`);
        showWindow();
        return;
      }
      configureBackend({ base: normalized, token: candidateToken });
      if (!desktop) saveWebEndpoint({ base: normalized, token: candidateToken });
      setBase(normalized);
      setToken(candidateToken);
      // 新连接代际: 目录/节点描述与旧连接缓存隔离, 立即加载
      const generation = useModelCatalogStore.getState().bumpGeneration();
      invalidateDescriptions();
      void useModelCatalogStore.getState().load(generation);
      setState('connected');
    } catch (error) {
      setState('unreachable');
      setDetail(errorText(error));
      showWindow();
    }
  }, [desktop, showWindow]);

  const start = useCallback(async () => {
    if (!desktop) {
      await connect(base, token);
      return;
    }
    setState('starting');
    setDetail('正在启动本地后端…');
    try {
      const info = await transport.call<SidecarInfo>('backend_sidecar_info');
      setLogPath(info.log_path);
      if (info.status !== 'running' || !info.base || !info.token) {
        setState(info.status === 'failed' ? 'crashed' : 'unreachable');
        setDetail(info.error ?? '本地后端未运行');
        showWindow();
        return;
      }
      // Process spawn precedes socket bind; retry the authenticated handshake briefly.
      for (let attempt = 0; attempt < 25; attempt += 1) {
        try {
          const health = await fetch(`${info.base}/api/v1/health`);
          if (health.ok) break;
        } catch { /* still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await connect(info.base, info.token, info.version);
    } catch (error) {
      setState('crashed');
      setDetail(errorText(error));
      showWindow();
    }
  }, [base, connect, desktop, showWindow, token]);

  useEffect(() => {
    if (initialCheckStarted.current) return;
    initialCheckStarted.current = true;
    void start();
  }, [start]);

  // Keep the business tree mounted only while its backend is healthy. Remounting after a
  // successful reconnect deliberately rehydrates workspace/settings/subscriptions from the
  // authoritative server instead of letting stale stores continue after a process restart.
  useEffect(() => {
    if (state !== 'connected') return undefined;
    const timer = window.setInterval(() => {
      void fetch(`${base}/api/v1/handshake`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }).then((response) => {
        if (response.ok) return;
        disconnectBackend();
        useModelCatalogStore.getState().bumpGeneration();
        invalidateDescriptions();
        setState(response.status === 401 ? 'unauthorized' : 'unreachable');
        setDetail(response.status === 401 ? '后端拒绝了当前访问令牌' : `后端连接中断：HTTP ${response.status}`);
      }).catch(async () => {
        disconnectBackend();
        useModelCatalogStore.getState().bumpGeneration();
        invalidateDescriptions();
        if (desktop) {
          const info = await transport.call<SidecarInfo>('backend_sidecar_info').catch(() => null);
          setState(info?.status === 'failed' ? 'crashed' : 'unreachable');
          setDetail(info?.error ?? '后端连接已中断');
          return;
        }
        setState('unreachable');
        setDetail('后端连接已中断');
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [base, desktop, state, token]);

  if (state === 'connected') return <CatalogGate>{children}</CatalogGate>;

  const restart = async () => {
    setState('starting');
    try {
      await transport.call('backend_sidecar_restart');
      await start();
    } catch (error) {
      setState('crashed');
      setDetail(errorText(error));
    }
  };

  const copyConnection = async () => {
    const copied = await writeTextToClipboard(`server=${base}\ntoken=${token}`);
    setCopyStatus(copied ? '连接信息已复制' : '无法访问剪贴板，请手动复制');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="module-card w-full max-w-lg space-y-4 p-6" aria-live="polite">
        <div>
          <h1 className="m-0 text-xl font-semibold">无法连接 Lissio 后端</h1>
          <p className="mt-2 text-sm opacity-secondary">{detail}</p>
        </div>
        <label className="block text-sm">
          服务器地址
          <input className="mt-1 w-full rounded border border-border bg-background px-3 py-2"
            value={base} onChange={(event) => setBase(event.target.value)} />
        </label>
        <label className="block text-sm">
          访问令牌
          <span className="mt-1 flex gap-2">
            <input type={showToken ? 'text' : 'password'} autoComplete="off"
              className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2"
              value={token} onChange={(event) => setToken(event.target.value)} />
            <button type="button" className="rounded border border-border px-3 py-2"
              onClick={() => setShowToken((visible) => !visible)}>
              {showToken ? '隐藏' : '显示'}
            </button>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="rounded bg-accent px-4 py-2" onClick={() => void connect(base, token)}>
            重新连接
          </button>
          {desktop && (
            <button className="rounded border border-border px-4 py-2" onClick={() => void restart()}>
              重启本地后端
            </button>
          )}
          {desktop && logPath && (
            <button className="rounded border border-border px-4 py-2"
              onClick={() => void transport.call('backend_sidecar_open_logs')}>
              打开日志目录
            </button>
          )}
          {desktop && base && token && (
            <button type="button" className="rounded border border-border px-4 py-2"
              onClick={() => void copyConnection()}>
              复制连接信息
            </button>
          )}
        </div>
        {copyStatus && <p className="text-xs opacity-secondary">{copyStatus}</p>}
        {logPath && <p className="break-all text-xs opacity-muted">日志：{logPath}</p>}
        <p className="text-xs opacity-muted">状态：{state}</p>
      </section>
    </main>
  );
}

/// 启动屏障 — 后端连接可用后, 模型目录就绪前不放行业务 UI (App 挂载即会
/// 恢复工作区并触发图同步, 目录失败时不得恢复/不得写空工作区覆盖原文件)。
/// 目录失败/不兼容显示可重试页; 重试只重新拉取目录, 不触碰工作区。
export function CatalogGate({ children }: { children: ReactNode }) {
  const status = useModelCatalogStore((s) => s.status);
  const error = useModelCatalogStore((s) => s.error);
  const contractVersion = useModelCatalogStore((s) => s.contractVersion);

  useEffect(() => {
    if (status !== 'idle') return;
    const { generation, load } = useModelCatalogStore.getState();
    void load(generation);
  }, [status]);

  const retry = () => {
    const { generation, load } = useModelCatalogStore.getState();
    void load(generation);
  };

  if (status === 'ready') return <>{children}</>;

  if (status === 'incompatible') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section className="module-card w-full max-w-lg space-y-4 p-6" aria-live="polite">
          <h1 className="m-0 text-xl font-semibold">模型目录版本不兼容</h1>
          <p className="mt-2 text-sm opacity-secondary">
            前端契约版本为 1，后端报告 {contractVersion}。请升级前端或后端后重试。
          </p>
          <button className="rounded bg-accent px-4 py-2" onClick={retry}>重新加载目录</button>
        </section>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section className="module-card w-full max-w-lg space-y-4 p-6" aria-live="polite">
          <h1 className="m-0 text-xl font-semibold">模型目录加载失败</h1>
          <p className="mt-2 text-sm opacity-secondary">{error ?? '未知错误'}</p>
          <p className="text-xs opacity-muted">工作区保持原样，未做任何写入。</p>
          <button className="rounded bg-accent px-4 py-2" onClick={retry}>重试</button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="module-card w-full max-w-lg space-y-3 p-6" aria-live="polite" aria-busy="true">
        <h1 className="m-0 text-xl font-semibold">正在加载模型目录…</h1>
        <p className="mt-2 text-sm opacity-secondary">目录就绪后才会恢复工作区。</p>
      </section>
    </main>
  );
}
