import React from 'react';
import { cn } from '../../utils/cn';

export const inputClasses = (hasLeftIcon?: boolean, hasError?: boolean) =>
  cn(
    'w-full rounded-md border bg-surface px-3 py-2.5 text-sm text-ink',
    'placeholder:text-gray-600 dark:placeholder:text-gray-400',
    'outline-none transition-colors duration-150',
    'focus:border-primary focus:ring-2 focus:ring-primary/30',
    'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-faint',
    hasLeftIcon && 'pl-10',
    hasError ? 'border-error-500 focus:border-error-500 focus:ring-error-500/30' : 'border-border-control',
  );

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  /** true for error styling only, or a string to also render the message */
  error?: boolean | string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ leftIcon, error, className, ...rest }, ref) => {
    const control = (
      <input ref={ref} className={cn(inputClasses(!!leftIcon, !!error), className)} {...rest} />
    );
    return (
      <div className="w-full">
        {leftIcon ? (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint [&>svg]:size-4.5" aria-hidden>
              {leftIcon}
            </span>
            {control}
          </div>
        ) : (
          control
        )}
        {typeof error === 'string' && error && (
          <p className="mt-1.5 text-xs text-error-600 dark:text-error-300">{error}</p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';

export default Input;
