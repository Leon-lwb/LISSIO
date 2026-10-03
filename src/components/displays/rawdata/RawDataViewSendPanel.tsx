import { Send } from 'lucide-react';
import type { AppendMode } from './rawDataViewHelpers';
import { t, type Lang } from '../../../i18n';
import { ToolbarButton } from '../../ui/ToolbarIconButton';
import { HorizontalScrollArea } from '../../ui/HorizontalScrollArea';

interface Props {
  appendMode: AppendMode;
  sendContent: string;
  onAppendModeChange: (v: AppendMode) => void;
  onSendContentChange: (v: string) => void;
  onSend: () => void;
  lang: Lang;
  compact?: boolean;
  /// 当前发送目标标签 (只读展示; null = 无可用目标, 禁用发送)
  /// 目标选择已上移至头部: 全局模式用头部选择器, 单通道模式锁定为连线串口
  targetTransportLabel: string | null;
}

export function RawDataViewSendPanel({
  appendMode,
  sendContent,
  onAppendModeChange,
  onSendContentChange,
  onSend,
  lang,
  compact = false,
  targetTransportLabel,
}: Props) {
  const appendOptions: { mode: AppendMode; label: string }[] = [
    { mode: 'none', label: t(lang, 'appendNone') },
    { mode: 'nl', label: t(lang, 'appendNewline') },
    { mode: 'tab', label: t(lang, 'appendTab') },
    { mode: 'nl_tab', label: t(lang, 'appendNewlineTab') },
  ];

  const renderAppendOptions = (vertical = false) => (
    <div className={`flex ${vertical ? 'flex-col' : 'items-center'} gap-0.5 ${vertical ? '' : 'flex-shrink-0'}`}>
      {!vertical && <span className="text-xs text-text-secondary mr-0.5">{t(lang, 'appendSuffix')}:</span>}
      {appendOptions.map((opt) => (
        <button
          key={opt.mode}
          className={`px-1.5 py-0.5 border rounded-sm text-xs font-mono cursor-pointer transition-all ${appendMode === opt.mode ? 'bg-accent border-accent text-text-inverse' : 'bg-bg-input border-border text-text-secondary hover:border-accent hover:text-text-primary'}`}
          aria-pressed={appendMode === opt.mode}
          onClick={() => onAppendModeChange(opt.mode)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const renderSendInput = () => (
    <input
      type="text"
      className="w-[220px] flex-shrink-0 px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm focus:outline-none focus:border-accent transition-colors"
      placeholder={lang === 'zh' ? '输入要发送的文本...' : 'Type to send...'}
      value={sendContent}
      onChange={(e) => onSendContentChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSend();
      }}
    />
  );

  const renderSendButton = () => (
    <ToolbarButton
      size="lg"
      variant="primary"
      className="px-3"
      icon={<Send />}
      label={t(lang, 'send')}
      labelMode="responsive-compact"
      onClick={onSend}
      disabled={!targetTransportLabel}
      title={!targetTransportLabel ? t(lang, 'noTransportNode') : t(lang, 'send')}
    />
  );

  const renderTargetLabel = () => (
    <span
      className="flex-shrink-0 text-xs text-text-secondary whitespace-nowrap font-mono max-w-[160px] truncate"
      title={t(lang, 'targetTransport')}
    >
      → {targetTransportLabel ?? t(lang, 'noTransportNode')}
    </span>
  );

  if (compact) {
    return (
      <div className="responsive-toolbar flex flex-col gap-1.5">
        <span className="text-xs text-text-secondary">{t(lang, 'appendSuffix')}</span>
        {renderAppendOptions(true)}
        {renderTargetLabel()}
        {renderSendInput()}
        {renderSendButton()}
      </div>
    );
  }

  return (
    <HorizontalScrollArea shellClassName="flex-shrink-0" className="responsive-toolbar flex flex-nowrap gap-1.5 p-1.5 items-center border-t border-border bg-bg-panel-header">
      {renderAppendOptions()}
      {renderTargetLabel()}
      {renderSendInput()}
      {renderSendButton()}
    </HorizontalScrollArea>
  );
}
