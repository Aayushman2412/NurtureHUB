import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface LayoutGroup {
  id: string;
  label: string;
}

export interface TableLayout {
  /** Is this column group showing? */
  show: (id: string) => boolean;
  compact: boolean;
  /** Cell padding for the current density. */
  pad: string;
  /** The Layout button and, when open, its panel — render above the table. */
  controls: React.ReactNode;
}

const read = (key: string): { hidden: string[]; compact: boolean } | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * "Layout" for any admin table, like the growth monitor's (review of 5 Oct
 * 2026: "this feature should be there in any table which we see"): tick
 * column groups on or off and make rows compact. Remembered per table in this
 * browser, so each reader keeps their own view.
 *
 *   const layout = useTableLayout('results_learners', [{ id: 'tests', label: 'Tests' }, …]);
 *   {layout.controls}
 *   {layout.show('tests') && <th>…</th>}
 */
export function useTableLayout(tableKey: string, groups: LayoutGroup[], extra?: React.ReactNode): TableLayout {
  const { t } = useTranslation('common');
  const storageKey = `nh_layout_${tableKey}`;
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(read(storageKey)?.hidden ?? []));
  const [compact, setCompact] = useState<boolean>(() => read(storageKey)?.compact ?? false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ hidden: [...hidden], compact }));
    } catch {
      // Private mode: the layout just isn't remembered.
    }
  }, [storageKey, hidden, compact]);

  const toggle = (id: string) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const controls = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
            open || hidden.size > 0 || compact
              ? 'border-primary/40 bg-primary/10 text-primary-ink'
              : 'border-border bg-surface text-ink hover:bg-surface-sunken',
          )}
        >
          <SlidersHorizontal className="size-4" />
          {t('layout.button')}
          {hidden.size > 0 && <span className="text-xs font-bold">({t('layout.hiddenN', { n: hidden.size })})</span>}
        </button>
        {extra}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{t('layout.columns')}</span>
            {groups.map(g => (
              <button
                key={g.id}
                type="button"
                aria-pressed={!hidden.has(g.id)}
                onClick={() => toggle(g.id)}
                className={cn(
                  'cursor-pointer rounded-full border px-2.5 py-1 text-sm font-medium transition-colors',
                  hidden.has(g.id)
                    ? 'border-border bg-surface text-ink-muted line-through'
                    : 'border-primary/30 bg-primary/10 text-primary-ink',
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink" title={t('layout.compactHint')}>
            <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} className="accent-primary" />
            {t('layout.compact')}
          </label>
          <button
            type="button"
            onClick={() => { setHidden(new Set()); setCompact(false); }}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <RotateCcw className="size-3.5" />
            {t('layout.reset')}
          </button>
        </div>
      )}
    </div>
  );

  return {
    show: id => !hidden.has(id),
    compact,
    pad: compact ? 'py-1' : 'py-2.5',
    controls,
  };
}
