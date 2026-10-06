//! 钥匙串授权拒绝说明 — 仅由启动读取返回 AiKeyringAccessDenied 时显示。

import { useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { translate } from '../i18n';
import { useAppStore } from '../store/appStore';
import { useSettingsStore } from '../store/settingsStore';
import { DialogOverlay, DialogSurface } from './ui/Dialog';

export interface KeychainPermissionDialogProps {
  /**
   * 是否显示。
   *
   * 由启动流程门控传入 (`resolveStartupFlow().showKeychainPermissionPrompt`), 而不是
   * 组件自己读 `keychainPermissionPromptOpen`: 那个原始标记不知道"首次引导是否已结束",
   * 于是引导期间它就可能已经是真。
   *
   * 更关键的是它必须与宿主描述符的 `open` **同一个值** —— 保活期间节点是否还在屏幕
   * 上由宿主的 `RetentionScope` 决定, 而组件自己的 `open` 决定它是否持票。两者不一致
   * 时 (宿主说关、组件说开) 这张票永远收不回来, 浮层会一直卡在屏幕上。
   */
  isOpen: boolean;
}

export function KeychainPermissionDialog({ isOpen }: KeychainPermissionDialogProps) {
  const lang = useAppStore((state) => state.lang);
  const retrying = useSettingsStore((state) => state.keychainPermissionRetrying);
  const retryError = useSettingsStore((state) => state.keychainPermissionRetryError);
  const dismiss = useSettingsStore((state) => state.dismissKeychainPermissionPrompt);
  const retry = useSettingsStore((state) => state.retryKeychainPermission);
  const [dontRemind, setDontRemind] = useState(false);

  return (
    <DialogOverlay open={isOpen} onDismiss={() => dismiss(dontRemind)}>
      <DialogSurface
        className="w-[460px] max-w-[92vw] px-7 py-6 flex flex-col gap-4"
        titleId="keychain-permission-title"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
            <KeyRound size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id="keychain-permission-title"
              className="text-base font-semibold text-text-bright m-0"
            >
              {translate('keychainPermissionTitle', lang)}
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed m-0 mt-1">
              {translate('keychainPermissionDescription', lang)}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-bg-input px-3 py-2.5 flex gap-2.5">
          <ShieldCheck size={17} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs text-text-secondary leading-relaxed">
            <p className="m-0">{translate('keychainPermissionPurpose', lang)}</p>
            <p className="m-0 mt-1">{translate('keychainPermissionImpact', lang)}</p>
          </div>
        </div>

        <p className="text-xs text-text-secondary leading-relaxed m-0">
          {translate('keychainPermissionRetryHint', lang)}
        </p>

        {retryError && (
          <p className="text-xs text-text-danger leading-relaxed m-0" role="alert">
            {translate(retryError === 'denied'
                ? 'keychainPermissionDeniedAgain'
                : 'keychainPermissionRetryFailed', lang)}
          </p>
        )}

        <label className="inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer w-fit">
          <input
            type="checkbox"
            className="accent-accent"
            checked={dontRemind}
            disabled={retrying}
            onChange={(event) => setDontRemind(event.target.checked)}
          />
          {translate('keychainPermissionDontRemind', lang)}
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="bg-transparent text-text-primary border border-border px-3 py-1.5 text-xs cursor-pointer rounded motion-transition hover:bg-bg-hover hover:border-accent hover:text-text-bright disabled:opacity-disabled disabled:cursor-not-allowed"
            disabled={retrying}
            onClick={() => dismiss(dontRemind)}
          >
            {translate('keychainPermissionLater', lang)}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-xs inline-flex items-center gap-1.5 transition-colors hover:bg-bg-button-hover disabled:opacity-disabled disabled:cursor-wait"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying && <RefreshCw size={12} className="motion-spin" aria-hidden="true" />}
            {translate(retrying ? 'keychainPermissionRequesting' : 'keychainPermissionRequestAgain', lang)}
          </button>
        </div>
      </DialogSurface>
    </DialogOverlay>
  );
}

/// 懒加载入口 — 见 `components/lazy/lazyComponents.ts` (全仓唯一 React.lazy 清单)。
export default KeychainPermissionDialog;
