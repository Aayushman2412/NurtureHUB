import React from 'react';
import { Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn';

type AlertVariant = 'info' | 'warning' | 'success' | 'error';

const styles: Record<AlertVariant, { box: string; icon: React.ReactNode }> = {
  info: {
    box: 'bg-info-50 border-info-500/30 text-info-600 dark:bg-info-500/10 dark:text-info-500',
    icon: <Info className="size-5" />,
  },
  warning: {
    box: 'bg-amber-50 border-amber-500/40 text-amber-700 dark:bg-amber-500/10 dark:text-amber-500',
    icon: <AlertTriangle className="size-5" />,
  },
  success: {
    box: 'bg-success-50 border-success-500/30 text-success-600 dark:bg-success-500/10 dark:text-success-500',
    icon: <CheckCircle2 className="size-5" />,
  },
  error: {
    box: 'bg-error-50 border-error-500/30 text-error-600 dark:bg-error-500/10 dark:text-error-500',
    icon: <XCircle className="size-5" />,
  },
};

export interface AlertProps {
  variant?: AlertVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

const Alert: React.FC<AlertProps> = ({ variant = 'info', title, children, className }) => {
  const s = styles[variant];
  return (
    <div role="alert" className={cn('flex gap-3 rounded-xl border px-4 py-3.5', s.box, className)}>
      <span className="shrink-0 mt-0.5" aria-hidden>{s.icon}</span>
      <div className="text-sm">
        {title && <div className="font-bold mb-0.5">{title}</div>}
        <div className="text-ink-muted [&_strong]:text-ink">{children}</div>
      </div>
    </div>
  );
};

export default Alert;
