import React from 'react';
import { Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn';

type AlertVariant = 'info' | 'warning' | 'success' | 'error';

const styles: Record<AlertVariant, { box: string; icon: React.ReactNode; iconTone: string }> = {
  info: {
    box: 'border-brand-200 border-l-brand-600 bg-brand-50 dark:border-brand-500/30 dark:border-l-brand-400 dark:bg-brand-500/10',
    icon: <Info className="size-5" />,
    iconTone: 'text-brand-700 dark:text-brand-300',
  },
  warning: {
    box: 'border-amber-200 border-l-amber-500 bg-amber-50 dark:border-amber-500/30 dark:border-l-amber-400 dark:bg-amber-500/10',
    icon: <AlertTriangle className="size-5" />,
    iconTone: 'text-amber-700 dark:text-amber-300',
  },
  success: {
    box: 'border-success-200 border-l-success-500 bg-success-50 dark:border-success-500/30 dark:border-l-success-400 dark:bg-success-500/10',
    icon: <CheckCircle2 className="size-5" />,
    iconTone: 'text-success-600 dark:text-success-300',
  },
  error: {
    box: 'border-error-200 border-l-error-500 bg-error-50 dark:border-error-500/30 dark:border-l-error-400 dark:bg-error-500/10',
    icon: <XCircle className="size-5" />,
    iconTone: 'text-error-600 dark:text-error-300',
  },
};

export interface AlertProps {
  variant?: AlertVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/** A note with a status rule on its left edge. The icon and the title carry the meaning, not the tint alone. */
const Alert: React.FC<AlertProps> = ({ variant = 'info', title, children, className }) => {
  const s = styles[variant];
  return (
    <div role="alert" className={cn('flex gap-3 rounded-md border border-l-[3px] px-4 py-3', s.box, className)}>
      <span className={cn('mt-0.5 shrink-0', s.iconTone)} aria-hidden>{s.icon}</span>
      <div className="min-w-0 text-sm">
        {title && <div className="mb-0.5 font-semibold text-ink">{title}</div>}
        <div className="text-ink-muted [&_strong]:text-ink">{children}</div>
      </div>
    </div>
  );
};

export default Alert;
