import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-display font-semibold rounded-lg ' +
  'transition-all duration-150 cursor-pointer select-none whitespace-nowrap ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm hover:shadow-md active:translate-y-px',
  secondary: 'bg-sage-600 text-white hover:bg-sage-700 shadow-sm active:translate-y-px dark:bg-sage-500 dark:hover:bg-sage-400 dark:text-sage-950',
  outline: 'border-2 border-primary text-primary-ink bg-transparent hover:bg-coral-50 dark:hover:bg-coral-950/40',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-sunken',
  danger: 'bg-error-500 text-white hover:bg-error-600 shadow-sm active:translate-y-px',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-1.5 rounded-md',
  md: 'text-sm px-4 py-2.5',
  lg: 'text-base px-6 py-3',
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
