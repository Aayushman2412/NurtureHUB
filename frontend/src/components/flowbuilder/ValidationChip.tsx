import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { FlowIssue } from '../../lib/flowGraph';
import { cn } from '../../utils/cn';
import { issueCounts } from './constants';

export interface ValidationChipProps {
  issues: FlowIssue[];
  /** Called with the issue's node id (null for form-level issues). */
  onSelectIssue: (nodeId: string | null) => void;
}

/** Toolbar validation status pill with a click-to-inspect issue popover. */
const ValidationChip: React.FC<ValidationChipProps> = ({ issues, onSelectIssue }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { errors, warnings } = issueCounts(issues);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pill =
    errors > 0
      ? 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500'
      : warnings > 0
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500'
        : 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500';
  const icon =
    errors > 0 ? (
      <XCircle className="size-3.5" />
    ) : warnings > 0 ? (
      <AlertTriangle className="size-3.5" />
    ) : (
      <CheckCircle2 className="size-3.5" />
    );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Validation issues"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer',
          pill,
        )}
      >
        {icon}
        {issues.length === 0 ? 'Ready' : `${issues.length} issue${issues.length > 1 ? 's' : ''}`}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-border bg-surface p-2 shadow-(--shadow-card-hover) animate-fade-in">
          {issues.length === 0 ? (
            <div className="flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-success-600 dark:text-success-500">
              <CheckCircle2 className="size-4" /> No issues — this flow is ready to publish.
            </div>
          ) : (
            <>
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold text-ink-faint">
                {errors > 0 && `${errors} error${errors > 1 ? 's' : ''}`}
                {errors > 0 && warnings > 0 && ' · '}
                {warnings > 0 && `${warnings} warning${warnings > 1 ? 's' : ''}`}
                {' — click an issue to jump to it'}
              </div>
              <ul className="max-h-72 overflow-y-auto">
                {issues.map((issue, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectIssue(issue.nodeId);
                        setOpen(false);
                      }}
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-muted hover:bg-surface-sunken cursor-pointer"
                    >
                      {issue.level === 'error' ? (
                        <XCircle className="mt-px size-3.5 shrink-0 text-rose-500" />
                      ) : (
                        <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-500" />
                      )}
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ValidationChip;
