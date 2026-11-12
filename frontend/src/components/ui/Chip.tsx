import React from 'react';
import { cn } from '../../utils/cn';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  count?: number;
}

/** Filter toggle (e.g. tutorial filters). Selected is outlined and tinted, not filled: it is a state, not an action. */
const Chip: React.FC<ChipProps> = ({ selected, count, className, children, ...rest }) => (
  <button
    type="button"
    aria-pressed={selected}
    className={cn(
      // Filter chips sit in a scrolling row and get thumbed at speed — clear
      // 44px on a phone, back to the compact size from `sm` up.
      'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium sm:min-h-0',
      'transition-colors duration-150',
      selected
        ? 'border-primary bg-brand-50 font-semibold text-primary-ink dark:bg-brand-500/15'
        : 'border-border-control bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink',
      className,
    )}
    {...rest}
  >
    {children}
    {typeof count === 'number' && (
      <span className={cn('text-[12px] tabular-nums', selected ? 'text-primary-ink' : 'text-ink-faint')}>
        {count}
      </span>
    )}
  </button>
);

export default Chip;
