import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md border font-semibold ' +
  'transition-colors duration-150 cursor-pointer select-none whitespace-nowrap ' +
  'disabled:opacity-50 disabled:pointer-events-none';

/**
 * One filled button per view (`primary`). `outline` is the everyday button for
 * everything else; `secondary` is the tinted step between the two, for a second
 * action that still matters. Nothing lifts or casts a shadow: the colour change
 * is the feedback.
 */
const variants: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-primary-fg hover:bg-primary-hover',
  secondary:
    'border-brand-200 bg-brand-50 text-primary-ink hover:bg-brand-100 ' +
    'dark:border-brand-500/40 dark:bg-brand-500/15 dark:hover:bg-brand-500/25',
  outline: 'border-border-control bg-surface text-ink hover:bg-surface-sunken',
  ghost: 'border-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'border-transparent bg-error-500 text-white hover:bg-error-600',
};

/**
 * Every size clears a 44px touch target on a phone and relaxes back to its
 * designed density from `sm` up. Padding alone gave `sm` a 32px button — fine
 * for a mouse, a miss-tap for a health worker holding a baby in one hand.
 */
const sizes: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-1.5 min-h-11 sm:min-h-0',
  md: 'text-sm px-4 py-2 min-h-11 sm:min-h-0',
  lg: 'text-base px-5 py-2.5 min-h-12',
};

/** Class string for styling non-button elements (e.g. router <Link>) like a Button. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(base, variants[variant], sizes[size], extra);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  iconLeft,
  iconRight,
  disabled,
  className,
  children,
  ...rest
}) => (
  <button
    className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
    disabled={disabled || loading}
    {...rest}
  >
    {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : iconLeft}
    {children}
    {!loading && iconRight}
  </button>
);

export default Button;
