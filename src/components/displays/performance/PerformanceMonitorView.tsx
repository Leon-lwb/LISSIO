import { memo, useMemo } from 'react';
import { Activity, Cpu, Gauge, MemoryStick, Pause, Play, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { usePerformanceStore } from '../../../store/performanceStore';
import { samplePerformanceOnce } from '../../../lib/performance/telemetry';
import { t } from '../../../i18n';
import type { FrontendPerformanceSnapshot } from '../../../types';

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0] ?? 'KB';
  for (const candidate of units.slice(1)) {
    if (value < 1024) break;
    value /= 1024;
    unit = candidate;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function Sparkline({ values, tone = 'accent' }: { values: number[]; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  const path = useMemo(() => {
    if (values.length === 0) return '';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = Math.max(max - min, 1);
    return values
      .map((value, index) => {
        const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
        const y = 25 - ((value - min) / span) * 21;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values]);

  const stroke = {
    accent: 'stroke-accent',
    success: 'stroke-text-success',
    warning: 'stroke-text-warning',
    danger: 'stroke-text-danger',
  }[tone];

  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full overflow-visible" aria-hidden="true">
      <line x1="0" y1="26" x2="100" y2="26" className="stroke-border-subtle" strokeWidth="1" />
      {path && <path d={path} fill="none" className={stroke} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function MetricCard({
  label,
  value,
  detail,
  values,
  tone = 'accent',
}: {
  label: string;
  value: string;
  detail: string;
  values: number[];
  tone?: 'accent' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="min-w-0 rounded-md border border-border-subtle bg-bg-panel p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate section-heading section-heading--micro">{label}</div>
          <div className="mt-1 truncate font-mono text-lg font-semibold tabular-nums text-text-bright">{value}</div>
          <div className="truncate text-[10px] text-text-secondary">{detail}</div>
        </div>
      </div>
      <div className="mt-2">
        <Sparkline values={values} tone={tone} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-8 items-center justify-between gap-4 border-b border-border-subtle px-2 last:border-b-0">
      <span className="truncate text-xs text-text-secondary">{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

const iconButtonClass =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary active:bg-accent-active';

export const PerformanceMonitorView = memo(function PerformanceMonitorView() {
  const lang = useAppStore((s) => s.lang);
  const frontend = usePerformanceStore((s) => s.frontend);
  const backend = usePerformanceStore((s) => s.backend);
  const frontendHistory = usePerformanceStore((s) => s.frontendHistory);
  const backendHistory = usePerformanceStore((s) => s.backendHistory);
  const paused = usePerformanceStore((s) => s.paused);
  const error = usePerformanceStore((s) => s.error);
  const setPaused = usePerformanceStore((s) => s.setPaused);
  const clearHistory = usePerformanceStore((s) => s.clearHistory);

  const frontSeries = <K extends keyof FrontendPerformanceSnapshot>(key: K) =>
    frontendHistory.map((sample) => Number(sample[key] ?? 0));
  const backCpu = backendHistory.map((sample) => sample.process.cpuPercent);
  const backMemory = backendHistory.map((sample) => sample.process.memoryBytes);
  const backRpc = backendHistory.map((sample) => sample.rpc.p95LatencyMs);
  const backDropped = backendHistory.map((sample) => sample.pipeline.droppedFrames + sample.websocket.droppedFrames);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg-panel" data-tour="performance-monitor">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel-header px-2.5">
        <Gauge size={14} className="text-accent" />
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-text-primary">
          {t(lang, 'performanceMonitor')}
        </span>
        {paused && (
          <span className="rounded-full bg-bg-input px-2 py-0.5 text-[10px] text-text-warning">
            {t(lang, 'performancePaused')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className={iconButtonClass}
            title={t(lang, paused ? 'performanceResume' : 'performancePause')}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title={t(lang, 'performanceRefresh')}
            onClick={() => void samplePerformanceOnce()}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title={t(lang, 'performanceClear')}
            onClick={clearHistory}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-warning/10 px-3 py-1.5 text-xs text-text-warning">
          <TriangleAlert size={13} />
          <span className="truncate">{error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!frontend && !backend ? (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">
            {t(lang, 'performanceWaiting')}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Activity size={14} className="text-accent" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-primary">
                  {t(lang, 'performanceFrontend')}
                </h3>
                <span className="text-[10px] text-text-secondary">{t(lang, 'performanceFrontendSource')}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <MetricCard
                  label={t(lang, 'performanceFps')}
                  value={(frontend?.fps ?? 0).toFixed(1)}
                  detail={t(lang, 'performanceFramesPerSecond')}
                  values={frontSeries('fps')}
                  tone={(frontend?.fps ?? 0) >= 50 ? 'success' : (frontend?.fps ?? 0) >= 30 ? 'warning' : 'danger'}
                />
                <MetricCard
                  label={t(lang, 'performanceFrameTime')}
                  value={`${(frontend?.frameTimeP95Ms ?? 0).toFixed(1)} ms`}
                  detail={`${t(lang, 'performanceAverage')}: ${(frontend?.frameTimeAverageMs ?? 0).toFixed(1)} ms`}
                  values={frontSeries('frameTimeP95Ms')}
                />
                <MetricCard
                  label={t(lang, 'performanceHeap')}
                  value={formatBytes(frontend?.jsHeapUsedBytes ?? null)}
                  detail={`${t(lang, 'performanceLimit')}: ${formatBytes(frontend?.jsHeapLimitBytes ?? null)}`}
                  values={frontSeries('jsHeapUsedBytes')}
                />
                <MetricCard
                  label={t(lang, 'performanceLongTasks')}
                  value={formatCount(frontend?.longTasksPerSecond ?? 0)}
                  detail={`${t(lang, 'performanceLongest')}: ${(frontend?.longestTaskMs ?? 0).toFixed(0)} ms`}
                  values={frontSeries('longTasksPerSecond')}
                  tone={(frontend?.longTasksPerSecond ?? 0) === 0 ? 'success' : 'warning'}
                />
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Cpu size={14} className="text-accent" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-primary">
                  {t(lang, 'performanceBackend')}
                </h3>
                <span className="text-[10px] text-text-secondary">{t(lang, 'performanceBackendSource')}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <MetricCard
                  label={t(lang, 'performanceCpu')}
                  value={`${(backend?.process.cpuPercent ?? 0).toFixed(1)}%`}
                  detail={`${t(lang, 'performanceThreads')}: ${backend?.process.threadCount ?? 0}`}
                  values={backCpu}
                  tone={(backend?.process.cpuPercent ?? 0) < 50 ? 'success' : 'warning'}
                />
                <MetricCard
                  label={t(lang, 'performanceMemory')}
                  value={formatBytes(backend?.process.memoryBytes ?? null)}
                  detail={`${t(lang, 'performanceUptime')}: ${Math.floor((backend?.process.uptimeMs ?? 0) / 60_000)} min`}
                  values={backMemory}
                />
                <MetricCard
                  label={t(lang, 'performanceRpcLatency')}
                  value={`${(backend?.rpc.p95LatencyMs ?? 0).toFixed(1)} ms`}
                  detail={`${t(lang, 'performanceAverage')}: ${(backend?.rpc.averageLatencyMs ?? 0).toFixed(1)} ms`}
                  values={backRpc}
                  tone={(backend?.rpc.p95LatencyMs ?? 0) < 100 ? 'success' : 'warning'}
                />
                <MetricCard
                  label={t(lang, 'performanceDropped')}
                  value={formatCount((backend?.pipeline.droppedFrames ?? 0) + (backend?.websocket.droppedFrames ?? 0))}
                  detail={`${t(lang, 'performanceQueue')}: ${formatCount(backend?.pipeline.queuedFrames ?? 0)}`}
                  values={backDropped}
                  tone={backDropped.some((value) => value > 0) ? 'danger' : 'success'}
                />
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="overflow-hidden rounded-md border border-border-subtle">
                <div className="flex h-8 items-center gap-2 border-b border-border-subtle bg-bg-panel-header px-2 text-xs font-semibold text-text-primary">
                  <MemoryStick size={13} /> {t(lang, 'performancePipeline')}
                </div>
                <SummaryRow label={t(lang, 'performanceCompleted')} value={formatCount(backend?.pipeline.completedFrames ?? 0)} />
                <SummaryRow label={t(lang, 'performanceQueue')} value={`${formatCount(backend?.pipeline.queuedFrames ?? 0)} / ${formatBytes(backend?.pipeline.queuedBytes ?? null)}`} />
                <SummaryRow label={t(lang, 'performanceEvalWait')} value={`${(backend?.pipeline.evalServiceMaxMs ?? 0).toFixed(1)} ms`} />
                <SummaryRow label={t(lang, 'performanceIngressDropped')} value={formatCount(backend?.pipeline.ingressDropped ?? 0)} />
              </div>

              <div className="overflow-hidden rounded-md border border-border-subtle">
                <div className="flex h-8 items-center gap-2 border-b border-border-subtle bg-bg-panel-header px-2 text-xs font-semibold text-text-primary">
                  <Activity size={13} /> RPC / WebSocket
                </div>
                <SummaryRow label={t(lang, 'performanceRpcCalls')} value={formatCount(backend?.rpc.calls ?? 0)} />
                <SummaryRow label={t(lang, 'performanceRpcErrors')} value={formatCount(backend?.rpc.errors ?? 0)} />
                <SummaryRow label={t(lang, 'performanceWsConnections')} value={formatCount(backend?.websocket.activeConnections ?? 0)} />
                <SummaryRow label={t(lang, 'performanceWsDropped')} value={`${formatCount(backend?.websocket.droppedFrames ?? 0)} / ${formatBytes(backend?.websocket.droppedBytes ?? null)}`} />
              </div>

              <div className="overflow-hidden rounded-md border border-border-subtle">
                <div className="flex h-8 items-center gap-2 border-b border-border-subtle bg-bg-panel-header px-2 text-xs font-semibold text-text-primary">
                  <Gauge size={13} /> {t(lang, 'performanceSampling')}
                </div>
                <SummaryRow label={t(lang, 'performanceSampleCount')} value={formatCount(frontendHistory.length)} />
                <SummaryRow label={t(lang, 'performanceMonitorRpc')} value={`${(frontend?.monitorRpcLatencyMs ?? 0).toFixed(1)} ms`} />
                <SummaryRow label={t(lang, 'performanceHeap')} value={formatBytes(frontend?.jsHeapUsedBytes ?? null)} />
                <SummaryRow label={t(lang, 'performanceLastSample')} value={frontend ? new Date(frontend.sampledAtMs).toLocaleTimeString() : '—'} />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
});
