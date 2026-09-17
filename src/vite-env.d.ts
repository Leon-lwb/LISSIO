/// <reference types="vite/client" />

/// 构建期 Web 出口默认端点 (见 `src/lib/rpc/index.ts` 的解析顺序)
interface ImportMetaEnv {
  /// 默认服务地址, 例如 `http://127.0.0.1:8790`; 缺省 = 同源
  readonly VITE_LISSIO_SERVER?: string;
  /// 默认 Bearer 令牌; 缺省 = 不带鉴权
  readonly VITE_LISSIO_TOKEN?: string;
}

declare module '*.yml?raw' {
  const content: string;
  export default content;
}

declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
