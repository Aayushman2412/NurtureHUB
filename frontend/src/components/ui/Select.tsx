import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

/** Styled native select. Cascading enable/disable stays in the consumer. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, className, children, ...rest }, ref) => (
    <div className="relative w-full">
      <select
        ref={ref}
        className={cn(
          'w-full cursor-pointer appearance-none rounded-md border bg-surface py-2.5 pl-3 pr-9 text-sm text-ink',
          'outline-none transition-colors duration-150',
          'focus:border-primary focus:ring-2 focus:ring-primary/30',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-faint disabled:opacity-70',
          error ? 'border-error-500 focus:border-error-500 focus:ring-error-500/30' : 'border-border-control',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
    </div>
  ),
);
Select.displayName = 'Select';

export default Select;
