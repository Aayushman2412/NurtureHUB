import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Field } from './Field';
import { inputClasses } from './Input';

export interface MultiSelectOption {
  value: number | string;
  label: string;
}

export interface MultiSelectProps {
  label: string;
  /** Currently picked values. Empty = "all", which is what the caller renders. */
  value: (number | string)[];
  onChange: (value: (number | string)[]) => void;
  options: MultiSelectOption[];
  /** Shown on the closed control when nothing is picked. */
  placeholder: string;
  disabled?: boolean;
  error?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  /** Label for the "select every filtered option" shortcut. */
  selectAllLabel?: string;
  clearLabel?: string;
  /** Renders "N selected" on the closed control. */
  selectedLabel?: (n: number) => string;
}

/**
 * A checkbox dropdown with type-to-filter search — the multi-pick counterpart to
 * SearchableSelect, for picking several learners (or any long list) by hand.
 *
 * Picked values are shown as removable chips under the control so a long
 * selection stays readable without opening the menu.
 */
const MultiSelect: React.FC<MultiSelectProps> = ({
  label, value, onChange, options, placeholder, disabled = false, error,
  emptyMessage = 'No matches', searchPlaceholder = 'Search...',
  selectAllLabel = 'Select all', clearLabel = 'Clear',
  selectedLabel = n => `${n} selected`,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const picked = useMemo(() => new Set(value.map(String)), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(''); inputRef.current?.focus(); }
  }, [open]);

  const toggle = (v: number | string) =>
    onChange(picked.has(String(v)) ? value.filter(x => String(x) !== String(v)) : [...value, v]);

  // "Select all" acts on what the search is showing, so it can build a subset.
  const selectAllFiltered = () => {
    const merged = [...value];
    for (const o of filtered) if (!picked.has(String(o.value))) merged.push(o.value);
    onChange(merged);
  };

  const chips = options.filter(o => picked.has(String(o.value)));

  return (
    <Field label={label} error={error}>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(o => !o)}
          className={cn(inputClasses(false, !!error), 'flex items-center justify-between text-left cursor-pointer')}
        >
          <span className={cn('truncate', value.length === 0 && 'text-ink-faint')}>
            {value.length === 0 ? placeholder : selectedLabel(value.length)}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 text-ink-faint" aria-hidden />
        </button>

        {open && (
          <div className="absolute top-full z-(--z-dropdown) mt-1.5 max-h-72 w-full overflow-hidden rounded-xl
                          border border-border bg-surface-raised shadow-lg animate-fade-in">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setOpen(false)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>

            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px]">
              <button
                type="button"
                onClick={selectAllFiltered}
                disabled={filtered.length === 0}
                className="font-semibold text-primary-ink hover:underline cursor-pointer disabled:opacity-40"
              >
                {selectAllLabel} ({filtered.length})
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={value.length === 0}
                className="font-semibold text-ink-muted hover:underline cursor-pointer disabled:opacity-40"
              >
                {clearLabel}
              </button>
            </div>

            <ul className="max-h-48 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <li className="px-3.5 py-2 text-sm text-ink-faint">{emptyMessage}</li>
              )}
              {filtered.map(o => {
                const isPicked = picked.has(String(o.value));
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => toggle(o.value)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors hover:bg-surface-sunken',
                        isPicked ? 'font-semibold text-primary-ink' : 'text-ink',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          isPicked ? 'border-primary bg-primary text-white' : 'border-border-strong/70',
                        )}
                        aria-hidden
                      >
                        {isPicked && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{o.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map(o => (
            <span
              key={o.value}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-surface-sunken px-2 py-1 text-[11px] text-ink"
            >
              <span className="truncate">{o.label}</span>
              <button
                type="button"
                aria-label={`${clearLabel}: ${o.label}`}
                onClick={() => toggle(o.value)}
                className="shrink-0 text-ink-faint hover:text-error-500 cursor-pointer"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </Field>
  );
};

export default MultiSelect;
