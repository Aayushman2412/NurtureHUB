import React from 'react';
import { cn } from '../../utils/cn';

export interface Figure {
  label: React.ReactNode;
  value: React.ReactNode;
  /** A short line under the figure: a time window, a comparison. */
  hint?: React.ReactNode;
  /** Status only. Draws a rule under the figure; say the status in the hint too. */
  tone?: 'success' | 'warning' | 'danger';
}

const toneRule = {
  success: 'shadow-[inset_0_-3px_0_var(--color-success-500)]',
  warning: 'shadow-[inset_0_-3px_0_var(--color-amber-500)]',
  danger: 'shadow-[inset_0_-3px_0_var(--color-error-500)]',
} as const;

export interface FiguresProps {
  items: Figure[];
  /** Columns from the `sm` breakpoint up. Phones always get two. */
  columns?: 2 | 3 | 4 | 6;
  className?: string;
}

const gridCols = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
} as const;

/**
 * A row of figures in one ruled panel, like the totals line of a register:
 * label above, number below, cells divided by hairlines. Use it for the
 * headline counts of a page; one StatCard is for a figure that stands alone.
 */
const Figures: React.FC<FiguresProps> = ({ items, columns = 4, className }) => (
  <dl
    className={cn(
      'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border',
      gridCols[columns],
      className,
    )}
  >
    {items.map((item, i) => (
      <div key={i} className={cn('min-w-0 bg-surface px-4 py-3', item.tone && toneRule[item.tone])}>
        <dt className="truncate text-sm text-ink-muted">{item.label}</dt>
        <dd className="mt-0.5 text-2xl font-semibold leading-tight tabular-nums text-ink">{item.value}</dd>
        {item.hint && <dd className="mt-0.5 truncate text-xs text-ink-muted">{item.hint}</dd>}
      </div>
    ))}
  </dl>
);

export default Figures;
