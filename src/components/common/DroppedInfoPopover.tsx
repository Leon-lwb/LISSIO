//! 数据丢弃说明弹层 — 状态栏丢弃告警 / 原始数据丢弃徽标共用
//!
//! - variant='rawdata': 指引到 设置→数据 (原始数据缓冲容量)
//! - variant='pipeline': 指引到 设置→性能 (并行 worker / 缓冲项)
//! - ESC / 点击遮罩关闭

import { useEffect } from 'react';
import { X, Settings } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';
import { translate } from '../../i18n';

interface DroppedInfoPopoverProps {
  open: boolean;
  onClose: () => void;
  variant: 'rawdata' | 'pipeline';
}

export function DroppedInfoPopover({ open, onClose, variant }: DroppedInfoPopoverProps) {
  const lang = useAppStore((s) => s.lang);
  const openSettings = useSettingsStore((s) => s.open);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const isRawdata = variant === 'rawdata';
  const titleKey = isRawdata ? 'droppedInfoTitleRawdata' : 'droppedInfoTitle';
  const whatKey = isRawdata ? 'droppedInfoWhatRawdata' : 'droppedInfoWhatPipeline';
  const howKey = isRawdata ? 'droppedInfoHowRawdata' : 'droppedInfoHowPipeline';

  return (
    <div
      className="fixed inset-0 dialog-overlay flex items-center justify-center z-modal motion-overlay-in"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClose(); } }}
      role="button"
      tabIndex={0}
    >
      <div
        className="w-[420px] max-w-[90vw] dialog-surface p-6 flex flex-col gap-3 relative motion-surface-in"
        role="dialog"
        aria-modal="true"
      >
        <button
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-bright transition-colors cursor-pointer bg-transparent border-none"
          onClick={onClose}
          title={translate('settingsClose', lang)}
        >
          <X size={16} />
        </button>

        <h2 className="prompt-card-title m-0">
          {translate(titleKey, lang)}
        </h2>
        <p className="prompt-card-body m-0">
          {translate(whatKey, lang)}
        </p>
        <p className="prompt-card-body m-0">
          {translate('droppedInfoWhy', lang)}
        </p>
        <p className="prompt-card-body m-0">
          {translate(howKey, lang)}
        </p>

        <div className="flex justify-end mt-1">
          <button
            className="prompt-card-btn"
            onClick={() => {
              onClose();
              openSettings(variant === 'rawdata' ? 'data' : 'performance');
            }}
          >
            <Settings size={14} />
            {translate('droppedInfoOpenSettings', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
