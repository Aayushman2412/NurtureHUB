import React from 'react';
import { cn } from '../../utils/cn';

export interface RatingGridRow {
  key: string;
  label: string;
}

export interface RatingGridColumn {
  key: string;
  label: string;
}

export type RatingGridValue = Record<string, Record<string, number>>;

export interface RatingGridProps {
  rows: RatingGridRow[];
  /** One or more rating scales per row (e.g. trust + willingness). */
  columns: RatingGridColumn[];
  /** Number of points on each scale (default 5). */
  scale?: number;
  value: RatingGridValue;
  onChange: (rowKey: string, columnKey: string, rating: number) => void;
  /** Header label for the leftmost (row-name) column. */
  rowHeader?: string;
  error?: string;
  disabled?: boolean;
}

/**
 * A survey rating grid: each row is rated on one or more 1–N scales. Powers the
 * trust/willingness matrix (rows = information sources, columns = trust + willingness).
 * Responsive: a table on ≥sm screens, stacked cards on mobile (no horizontal scroll).
 */
const RatingGrid: React.FC<RatingGridProps> = ({
  rows, columns, scale = 5, value, onChange, rowHeader = '', error, disabled = false,
}) => {
  const scaleButtons = (rowKey: string, col: RatingGridColumn, ariaLabel: string) => {
    const current = value[rowKey]?.[col.key];
    return (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
        {Array.from({ length: scale }, (_, i) => i + 1).map(n => {
          const selected = current === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(rowKey, col.key, n)}
              className={cn(
                'flex size-8 items-center justify-center rounded-md border text-[13px] transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-60',
                selected
                  ? 'border-primary bg-primary text-primary-fg font-semibold'
                  : 'border-border-strong/60 text-ink-muted hover:border-primary hover:text-primary',
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      {/* ≥sm: table layout */}
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunken/50">
              <th className="px-3 py-2.5 text-left font-semibold text-ink-muted">{rowHeader}</th>
              {columns.map(c => (
                <th key={c.key} className="px-3 py-2.5 text-left font-semibold text-ink-muted">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2.5 text-ink">{row.label}</td>
                {columns.map(col => (
                  <td key={col.key} className="px-3 py-2.5">
                    {scaleButtons(row.key, col, `${row.label} — ${col.label}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile: one card per row, each scale stacked and labelled */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map(row => (
          <div key={row.key} className="rounded-xl border border-border p-3.5">
            <div className="mb-3 font-semibold text-ink">{row.label}</div>
            <div className="flex flex-col gap-3">
              {columns.map(col => (
                <div key={col.key} className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-ink-muted">{col.label}</span>
                  {scaleButtons(row.key, col, `${row.label} — ${col.label}`)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="mt-1.5 text-xs text-error-500">{error}</p>}
    </div>
  );
};

export default RatingGrid;
