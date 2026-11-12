import React from 'react';
import { cn } from '../../utils/cn';

export type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

const variants: Record<BadgeVariant, string> = {
  success: 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/15 dark:text-success-300',
  error: 'border-error-200 bg-error-50 text-error-600 dark:border-error-500/30 dark:bg-error-500/15 dark:text-error-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
  info: 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300',
  neutral: 'border-border bg-surface-sunken text-ink-muted',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

/** A small rectangular tag carrying one status word. */
const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', size = 'sm', className, children, ...rest }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-sm border font-medium whitespace-nowrap',
      size === 'sm' ? 'px-1.5 py-px text-[12px]' : 'px-2 py-0.5 text-xs',
      variants[variant],
      className,
    )}
    {...rest}
  >
    {children}
  </span>
);

export default Badge;
