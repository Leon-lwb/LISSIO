import type { HTMLAttributes, ReactNode } from 'react';

interface DialogOverlayProps extends HTMLAttributes<HTMLDivElement> {
  zClassName?: string;
}

export function DialogOverlay({
  className = '',
  zClassName = 'z-modal',
  children,
  ...props
}: DialogOverlayProps) {
  return (
    <div className={`dialog-overlay ${zClassName} ${className}`} {...props}>
      {children}
    </div>
  );
}

interface DialogSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function DialogSurface({ className = '', children, label, ...props }: DialogSurfaceProps) {
  return (
    <div className={`dialog-surface ${className}`} role="dialog" aria-modal="true" aria-label={label} {...props}>
      {children}
    </div>
  );
}

export function DialogHeader({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`dialog-header dialog-chrome ${className}`}>{children}</div>;
}

export function DialogBody({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`dialog-body ${className}`}>{children}</div>;
}

export function DialogFooter({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`dialog-footer dialog-chrome ${className}`}>{children}</div>;
}
