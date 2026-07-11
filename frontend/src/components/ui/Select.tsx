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
          'w-full appearance-none bg-surface text-ink border rounded-lg pl-3.5 pr-9 py-2.5 text-sm',
          'transition-colors duration-150 outline-none cursor-pointer',
          'focus:border-primary focus:ring-2 focus:ring-primary/25',
          'disabled:bg-surface-sunken disabled:text-ink-faint disabled:cursor-not-allowed disabled:opacity-70',
          error ? 'border-error-500 focus:border-error-500 focus:ring-error-500/25' : 'border-border-strong/60',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint"
        aria-hidden
      />
    </div>
  ),
);
Select.displayName = 'Select';

export default Select;
