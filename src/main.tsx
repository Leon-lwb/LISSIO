import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nextProvider, i18n } from "./i18n";
import { BackendConnectionGate } from './components/BackendConnectionGate';
import { installMotionTokens, watchReducedMotion } from './lib/motion';
import "./styles/theme.css";
import "./styles/components.css";

// 动效地基: 先把系统低动画偏好同步成 <html> 上的唯一权威类, 再烘焙一次弹簧令牌。
// 必须在 React 挂载前完成, 避免首帧使用未烘焙的兜底曲线。
watchReducedMotion();
installMotionTokens(true);

// 过滤已知的良性 ResizeObserver 告警 — 打开节点画布等场景下,
// 第三方库 (@xyflow/react 节点测量) 内部的 RO 会在同一帧内循环触发,
// 浏览器抛出 "ResizeObserver loop completed ..." ErrorEvent。
// 该告警无实际影响 (未送达的通知下一帧会重发), 且无法在库内部修复, 在此统一静音。
const BENIGN_RO_MESSAGES = [
  "ResizeObserver loop completed with undelivered notifications",
  "ResizeObserver loop limit exceeded",
];
window.addEventListener("error", (e) => {
  if (BENIGN_RO_MESSAGES.some((m) => e.message?.includes(m))) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <BackendConnectionGate>
        <App />
      </BackendConnectionGate>
    </I18nextProvider>
  </React.StrictMode>,
);
