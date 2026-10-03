import type { ReactNode } from 'react';

export function FormField({
  label,
  error,
  flex = false,
  children,
}: {
  label: string;
  error?: string | null;
  flex?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`form-field ${flex ? 'form-field--flex' : ''}`}>
      <span className="form-label">{label}</span>
      {children}
      {error && <span className="form-error">{error}</span>}
    </label>
  );
}

export function FieldGrid({
  variant = 'default',
  className = '',
  children,
}: {
  variant?: 'compact' | 'default' | 'wide';
  className?: string;
  children: ReactNode;
}) {
  return <div className={`field-grid field-grid--${variant} ${className}`}>{children}</div>;
}

export function SectionHeading({
  divided = false,
  className = '',
  children,
}: {
  divided?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`section-heading ${divided ? 'section-heading--divided' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
