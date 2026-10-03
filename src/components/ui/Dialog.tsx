import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useMotionPresence } from '../../lib/motion';

interface DialogOverlayProps extends HTMLAttributes<HTMLDivElement> {
  zClassName?: string;
}

export function DialogOverlay({
  className = '',
  zClassName = 'z-modal',
  children,
  ...props
}: DialogOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  useMotionPresence(ref, { variant: 'overlay' });

  return (
    <div ref={ref} className={`dialog-overlay ${zClassName} ${className}`} {...props}>
      {children}
    </div>
  );
}

interface DialogSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function DialogSurface({ className = '', children, label, ...props }: DialogSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  useMotionPresence(ref, { variant: 'surface' });

  return (
    <div
      ref={ref}
      className={`dialog-surface motion-float ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      {...props}
    >
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
