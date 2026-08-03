import React from 'react';
import { cn } from '../../utils/cn';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  count?: number;
}

/** Filter chip (e.g. tutorial filters). */
const Chip: React.FC<ChipProps> = ({ selected, count, className, children, ...rest }) => (
  <button
    type="button"
    aria-pressed={selected}
    className={cn(
      // Filter chips sit in a scrolling row and get thumbed at speed — clear
      // 44px on a phone, back to the compact pill from `sm` up.
      'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold cursor-pointer sm:min-h-0',
      'border transition-colors duration-150',
      selected
        ? 'bg-primary text-primary-fg border-primary'
        : 'bg-surface text-ink-muted border-border hover:border-border-strong hover:text-ink',
      className,
    )}
    {...rest}
  >
    {children}
    {typeof count === 'number' && (
      <span
        className={cn(
          'rounded-full text-[11px] px-1.5 py-px font-bold',
          selected ? 'bg-primary-fg/20' : 'bg-surface-sunken text-ink-faint',
        )}
      >
        {count}
      </span>
    )}
  </button>
);

export default Chip;
