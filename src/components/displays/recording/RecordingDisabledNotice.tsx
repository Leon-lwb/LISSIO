import { Database } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { t } from '../../../i18n';

/// 录制数据库被用户关闭时的说明条。
///
/// 设计要求是「入口保留但禁用并给出原因提示」: 面板与视图都不隐藏, 但必须让
/// 用户一眼看出**为什么没有数据**, 并且一键跳回设置打开开关。
export function RecordingDisabledNotice({ compact = false }: { compact?: boolean }) {
  const lang = useAppStore((s) => s.lang);
  const openSettings = useSettingsStore((s) => s.open);

  return (
    <div
      className="flex items-start gap-1.5 rounded border border-border-subtle bg-bg-input px-2 py-1 text-[10px] text-text-secondary"
      data-testid="recording-disabled-notice"
    >
      <Database size={12} className="mt-0.5 shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1">
        {t(lang, compact ? 'recordingDisabledShort' : 'recordingDisabledNotice')}
      </span>
      <button
        type="button"
        className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-bg-hover"
        onClick={() => openSettings('data')}
      >
        {t(lang, 'recordingDisabledOpenSettings')}
      </button>
    </div>
  );
}
