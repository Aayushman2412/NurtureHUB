import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
  itemLabel?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className,
  itemLabel = 'items',
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  if (totalItems === 0) {
    return null;
  }

  const startItem = (validCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, validCurrentPage * pageSize);

  const getPageNumbers = (): (number | string)[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (validCurrentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (validCurrentPage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', validCurrentPage - 1, validCurrentPage, validCurrentPage + 1, '...', totalPages];
  };

  const pages = getPageNumbers();

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 pb-2 text-sm text-ink-muted',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Showing <span className="font-semibold text-ink">{startItem}–{endItem}</span> of{' '}
          <span className="font-semibold text-ink">{totalItems}</span> {itemLabel}
        </span>

        {onPageSizeChange && pageSizeOptions.length > 1 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-ink-faint">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-primary"
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 select-none">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={validCurrentPage <= 1}
          aria-label="First page"
          title="First page"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronsLeft className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => onPageChange(validCurrentPage - 1)}
          disabled={validCurrentPage <= 1}
          aria-label="Previous page"
          title="Previous page"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft className="size-3.5" />
        </button>

        <div className="flex items-center gap-1 px-1">
          {pages.map((p, idx) => {
            if (p === '...') {
              return (
                <span key={`ellipsis-${idx}`} className="px-1 text-xs text-ink-faint">
                  …
                </span>
              );
            }
            const isCurrent = p === validCurrentPage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p as number)}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'inline-flex min-w-8 h-8 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors',
                  isCurrent
                    ? 'bg-primary font-bold text-primary-fg shadow-sm'
                    : 'border border-transparent text-ink-muted hover:border-border hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {p}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onPageChange(validCurrentPage + 1)}
          disabled={validCurrentPage >= totalPages}
          aria-label="Next page"
          title="Next page"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronRight className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={validCurrentPage >= totalPages}
          aria-label="Last page"
          title="Last page"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronsRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
