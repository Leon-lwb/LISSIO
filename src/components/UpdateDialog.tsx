//! 更新弹窗 — 自动检查发现新版本时弹出 (也可由状态栏指示器手动打开)
//!
//! 仿 AboutModal: 遮罩 + 居中卡片, Esc/点遮罩关闭
//! 下载中禁止关闭 (避免用户误以为更新已取消)

import { X, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useUpdateStore } from '../store/updateStore';
import { translate } from '../i18n';
import { DialogOverlay, DialogSurface } from './ui/Dialog';

export function UpdateDialog() {
  const lang = useAppStore((s) => s.lang);
  const dialogOpen = useUpdateStore((s) => s.dialogOpen);
  const status = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const relaunch = useUpdateStore((s) => s.relaunch);
  const skipVersion = useUpdateStore((s) => s.skipVersion);
  const closeDialog = useUpdateStore((s) => s.closeDialog);

  /// 下载中禁止关闭
  const closable = status !== 'downloading';

  return (
    // `onDismiss` 在不可关闭时留空: 栈里的这一层仍然占位, Escape 到此为止, 不会
    // 穿透到它背后的浮层 —— 用户看到的是"按了没反应", 而不是"更新弹窗背后的东西
    // 被关掉了"。
    <DialogOverlay open={dialogOpen} onDismiss={closable ? closeDialog : undefined}>
      <DialogSurface
        className="w-[440px] max-w-[90vw] max-h-[80vh] py-6 px-7 flex flex-col gap-2 relative"
        label={translate('updateAvailableTitle', lang)}
      >
        {closable && (
          <button
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-bright transition-colors cursor-pointer bg-transparent border-none"
            onClick={closeDialog}
            title={translate('updateLater', lang)}
          >
            <X size={16} />
          </button>
        )}

        <h2 className="text-base font-semibold text-text-bright m-0">
          {translate('updateAvailableTitle', lang)}
        </h2>

        {updateInfo && (
          <p className="text-sm text-text-secondary m-0">
            <code className="bg-bg-input px-1.5 py-0.5 rounded-sm text-text-primary font-mono">v{currentVersion}</code>
            <span className="mx-1.5">→</span>
            <code className="bg-bg-input px-1.5 py-0.5 rounded-sm text-text-primary font-mono">v{updateInfo.version}</code>
          </p>
        )}
        {updateInfo?.date && (
          <p className="text-xs text-text-secondary m-0">
            {translate('updateReleaseDate', lang)}: {updateInfo.date}
          </p>
        )}

        {updateInfo?.notes && (
          <>
            <div className="section-heading mt-2">
              {translate('updateReleaseNotes', lang)}
            </div>
            <div className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap max-h-[240px] overflow-y-auto bg-bg-input rounded px-3 py-2 border border-border">
              {updateInfo.notes}
            </div>
          </>
        )}

        {status === 'downloading' && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-accent motion-transition"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-text-secondary tabular-nums">{progress}%</span>
          </div>
        )}

        {status === 'ready' && (
          <p className="text-xs text-text-secondary m-0 mt-2">{translate('updateReadyHint', lang)}</p>
        )}

        {status === 'error' && (
          <p className="text-xs text-text-danger m-0 mt-2 break-all">
            {translate('updateError', lang)}: {error}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          {status === 'available' && (
            <>
              <button
                className="bg-transparent text-text-secondary border-none px-2.5 py-1 text-xs cursor-pointer rounded transition-colors hover:bg-bg-hover hover:text-text-primary"
                onClick={skipVersion}
              >
                {translate('updateSkipVersion', lang)}
              </button>
              <button
                className="bg-transparent text-text-primary border border-border px-2.5 py-1 text-xs cursor-pointer rounded motion-transition hover:bg-bg-hover hover:border-accent hover:text-text-bright"
                onClick={closeDialog}
              >
                {translate('updateLater', lang)}
              </button>
              <button
                className="px-3 py-1 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-xs inline-flex items-center gap-1.5 transition-colors hover:bg-bg-button-hover"
                onClick={() => void downloadAndInstall()}
              >
                {translate('updateNow', lang)}
              </button>
            </>
          )}
          {status === 'downloading' && (
            <span className="text-xs text-text-secondary inline-flex items-center gap-1.5">
              <RefreshCw size={12} className="motion-spin" />
              {translate('updateDownloading', lang)}
            </span>
          )}
          {status === 'ready' && (
            <button
              className="px-3 py-1 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-xs transition-colors hover:bg-bg-button-hover"
              onClick={() => void relaunch()}
            >
              {translate('updateRestart', lang)}
            </button>
          )}
          {status === 'error' && (
            <button
              className="px-3 py-1 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-xs transition-colors hover:bg-bg-button-hover"
              onClick={() => void downloadAndInstall()}
            >
              {translate('updateRetry', lang)}
            </button>
          )}
        </div>
      </DialogSurface>
    </DialogOverlay>
  );
}

/// 懒加载入口 — 见 `components/lazy/lazyComponents.ts` (全仓唯一 React.lazy 清单)。
export default UpdateDialog;
