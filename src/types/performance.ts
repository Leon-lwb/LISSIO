/// Frontend-owned renderer performance sample.
///
/// Backend process metrics use the generated Rust contract; this type covers
/// browser/WebView signals that cannot be observed from the backend process.
export interface FrontendPerformanceSnapshot {
  sampledAtMs: number;
  fps: number;
  frameTimeAverageMs: number;
  frameTimeP95Ms: number;
  longTasksPerSecond: number;
  longestTaskMs: number;
  jsHeapUsedBytes: number | null;
  jsHeapLimitBytes: number | null;
  monitorRpcLatencyMs: number | null;
}
