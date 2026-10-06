import { useEffect, useState } from 'react';
import { notify, type AppNotification } from '../lib/tauri/notifications';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';
import { XCircle, AlertTriangle, Info, X, ChevronDown } from 'lucide-react';
import { activateOnKeyboard } from '../lib/utils/a11y';
import { MotionPresence } from '../lib/motion';
import { useGlassSurface } from '../lib/glass/useGlassSurface';
import { useGlassAppearance } from '../lib/hooks/useGlassAppearance';

const MAX_VISIBLE = 5;

/// 统一提示 Toast 容器 — 右下角悬浮, 最多 5 条, 超出折叠
/// 卡片样式与首次使用引导提示框 (TourOverlay) 统一 (prompt-card 系列类)
export function NotificationToasts() {
  const lang = useAppStore((s) => s.lang);
  const [list, setList] = useState<AppNotification[]>(notify.getList());

  useEffect(() => {
    return notify.subscribe(setList);
  }, []);

  const visible = list.slice(0, MAX_VISIBLE);
  const hiddenCount = list.length - MAX_VISIBLE;

  const dismiss = (id: string) => notify.dismiss(id);
  const dismissAll = () => notify.dismissAll();

  return (
    <div className="fixed right-4 bottom-8 z-200 flex flex-col items-end gap-2 pointer-events-none max-w-[380px]">
      {hiddenCount > 0 && (
        <button
          className="pointer-events-auto bg-bg-sidebar border border-border rounded-lg px-3 py-1.5 text-xs cursor-pointer inline-flex items-center gap-1 transition-colors hover:bg-bg-hover hover:text-text-bright"
          onClick={dismissAll}
          title={translate('notifDismissAll', lang)}
        >
          <ChevronDown size={12} />
          {translate('notifMore', lang).replace('{{count}}', String(hiddenCount))}
        </button>
      )}
      {visible.map((n) => (
        <ToastItem
          key={n.id}
          notif={n}
          lang={lang}
          onDismiss={() => dismiss(n.id)}
        />
      ))}
    </div>
  );
}

interface ToastItemProps {
  notif: AppNotification;
  lang: 'zh' | 'en';
  onDismiss: () => void;
}

function ToastItem({ notif, lang, onDismiss }: ToastItemProps) {
  const [closing, setClosing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const glass = useGlassSurface({ role: 'transient', appearance: useGlassAppearance() });

  const requestDismiss = () => {
    if (!closing) setClosing(true);
  };

  const Icon =
    notif.severity === 'error'
      ? XCircle
      : notif.severity === 'warn'
      ? AlertTriangle
      : Info;

  const severityLabel =
    notif.severity === 'error'
      ? translate('notifError', lang)
      : notif.severity === 'warn'
      ? translate('notifWarn', lang)
      : translate('notifInfo', lang);

  const iconColorClass =
    notif.severity === 'error' ? 'text-red' :
    notif.severity === 'warn' ? 'text-yellow' :
    'text-blue';

  const severityTagClass =
    notif.severity === 'error' ? 'text-red bg-red/10' :
    notif.severity === 'warn' ? 'text-yellow bg-yellow/10' :
    'text-blue bg-blue/10';

  const progressColorClass =
    notif.severity === 'warn' ? 'bg-yellow' :
    notif.severity === 'info' ? 'bg-blue' :
    'bg-text-secondary';

  const handleAction = (run: () => void) => {
    run();
    requestDismiss();
  };

  return (
    <MotionPresence
      visible={!closing}
      variant="toast"
      className="pointer-events-auto relative w-[360px]"
      onExitComplete={onDismiss}
    >
    <div
      ref={glass.ref}
      className="prompt-card frost-acrylic motion-float h-full relative w-full p-4 flex flex-col gap-2.5 overflow-hidden"
      data-glass-tier={glass.tier}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 头部: 图标 + 标题 + 严重级别眉标 (引导风格小号大写标签) + 关闭 */}
      <div className="flex items-start gap-2">
        <div className={`shrink-0 flex items-center justify-center pt-0.5 ${iconColorClass}`}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="prompt-card-title flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {notif.title}
            {notif.count > 1 && (
              <span className="text-text-secondary font-normal font-mono text-xs cursor-help" title={translate('notifCollapsedHint', lang)}>
                {' '}×{notif.count}
              </span>
            )}
          </span>
          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm shrink-0 ${severityTagClass}`}>
            {severityLabel}
          </span>
        </div>
        <button
          className="shrink-0 bg-transparent border-none text-text-secondary cursor-pointer p-0.5 rounded-sm flex items-center justify-center transition-colors hover:bg-bg-hover hover:text-text-bright"
          onClick={requestDismiss}
          title={translate('notifDismiss', lang)}
          aria-label={translate('notifDismiss', lang)}
        >
          <X size={14} />
        </button>
      </div>

      {/* 消息 — 与引导提示框正文同款排版 */}
      <div
        className={`prompt-card-body font-mono cursor-pointer overflow-hidden break-all whitespace-pre-wrap transition-[max-height]-out ml-6 ${expanded ? 'max-h-[200px]' : 'max-h-[4.5em]'}`}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={activateOnKeyboard}
        role="button"
        tabIndex={0}
      >
        {notif.message}
      </div>

      {notif.actions.length > 0 && (
        <div className="flex gap-1.5 mt-0.5 flex-wrap ml-6">
          {notif.actions.map((a, i) => (
            <button
              key={i}
              className="prompt-card-btn"
              onClick={() => handleAction(a.run)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* 悬停时显示进度条 (info/warn 自动消失; 常驻提示 durationMs=0 不倒计时) */}
      {notif.severity !== 'error' && notif.durationMs > 0 && (
        <div
          className={`absolute left-0 bottom-0 h-0.5 opacity-subtle notif-progress ${progressColorClass} ${hovered ? 'paused' : ''}`}
          key={notif.timestamp}
        />
      )}
    </div>
    </MotionPresence>
  );
}
