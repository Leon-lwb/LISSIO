import { cloneElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import clsx from 'clsx';

export type ToolbarLabelMode = 'always' | 'responsive' | 'responsive-wide' | 'responsive-compact' | 'never';

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactElement<{ size?: number; className?: string }>;
  label?: string;
  labelMode?: ToolbarLabelMode;
  children?: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'selected' | 'primary' | 'danger' | 'success';
  title?: string;
}

const LABEL_CLASS: Record<Exclude<ToolbarLabelMode, 'always' | 'never'>, string> = {
  responsive: 'responsive-toolbar-label',
  'responsive-wide': 'responsive-toolbar-label-wide',
  'responsive-compact': 'responsive-toolbar-label-compact',
};

/// 工具栏按钮统一基类: 图标/文字可组合，文字可按工具栏空间响应式收起。
export function ToolbarButton({
  icon,
  label,
  labelMode = 'always',
  children,
  active = false,
  size = 'md',
  variant = 'default',
  title,
  className = '',
  ...rest
}: ToolbarButtonProps) {
  const dimension =
    size === 'sm'
      ? 'h-5 min-w-5 px-1'
      : size === 'lg'
        ? 'h-7 min-w-7 px-2'
        : 'h-6 min-w-6 px-1.5';
  const iconSize = size === 'sm' ? 12 : 14;
  const labelClass =
    labelMode === 'always'
      ? ''
      : labelMode === 'never'
        ? 'hidden'
        : LABEL_CLASS[labelMode];

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={clsx(
        'inline-flex items-center justify-center gap-1 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer flex-shrink-0 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-disabled',
        dimension,
        variant === 'primary'
          ? 'bg-bg-button text-text-inverse hover:bg-bg-button-hover'
          : variant === 'danger'
            ? active
              ? 'bg-bg-danger text-red'
              : 'text-text-secondary hover:bg-bg-danger hover:text-red'
            : variant === 'success'
              ? 'text-green bg-accent/15'
              : active
                ? variant === 'selected'
                  ? 'bg-bg-button text-text-inverse'
                  : 'bg-accent/15 text-text-bright'
                : variant === 'selected'
                  ? 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        className,
      )}
      {...rest}
    >
      {icon ? cloneElement(icon, { size: iconSize }) : null}
      {label ? <span className={clsx('leading-none', labelClass)}>{label}</span> : null}
      {children}
    </button>
  );
}

/// 兼容既有调用的图标按钮入口，视觉与响应式行为共用 ToolbarButton 基类。
export function ToolbarIconButton(props: Omit<ToolbarButtonProps, 'children'>) {
  return <ToolbarButton {...props} />;
}
