import { ArrowDownToLine } from 'lucide-react';
import { t, type Lang } from '../../../i18n';

interface Props {
  lang: Lang;
  onClick: () => void;
}

/// 视口右下角"回到最新"按钮 — 用户上滚脱离最新数据后出现 (由父级条件挂载)。
/// 脱离状态下环形缓冲仍在滑动, 视口到最新数据的距离可能很大; 点此瞬时回到最新。
export function RawDataBackToLatest({ lang, onClick }: Props) {
  const label = t(lang, 'rawDataBackToLatest');
  return (
    <button
      type="button"
      className="absolute bottom-3 right-3 z-10 grid size-7 place-items-center rounded-full border border-border bg-bg-panel-header text-text-primary shadow-lg transition-colors hover:bg-bg-hover motion-safe:active:scale-95 cursor-pointer"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <ArrowDownToLine size={14} />
    </button>
  );
}
