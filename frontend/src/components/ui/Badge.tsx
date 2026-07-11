import React from 'react';
import { cn } from '../../utils/cn';

export type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'teal' | 'coral';

const variants: Record<BadgeVariant, string> = {
  success: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500',
  error: 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
  info: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-500',
  neutral: 'bg-surface-sunken text-ink-muted',
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  coral: 'bg-coral-50 text-coral-700 dark:bg-coral-500/15 dark:text-coral-300',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', size = 'sm', className, children, ...rest }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
      size === 'sm' ? 'text-[11px] px-2.5 py-0.5' : 'text-xs px-3 py-1',
      variants[variant],
      className,
    )}
    {...rest}
  >
    {children}
  </span>
);

export default Badge;
