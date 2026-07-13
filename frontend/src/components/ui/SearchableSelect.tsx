import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Field } from './Field';
import { inputClasses } from './Input';

export interface SearchableSelectOption {
  value: number | string;
  label: string;
}

export interface SearchableSelectProps {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder: string;
  disabled?: boolean;
  error?: string;
  /** Message shown when a search yields nothing. */
  emptyMessage?: string;
}

/**
 * A labelled combobox: a dropdown with a type-to-filter search box. For long option
 * lists (facilities, HWC/PHC, degrees) where a plain <select> is unwieldy. Keeps the
 * same value/onChange contract as SelectField so it drops into the same forms.
 */
const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label, value, onChange, options, placeholder, disabled = false, error, emptyMessage = 'No matches',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => String(o.value) === String(value));

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
    if (open) { setQuery(''); setActive(0); inputRef.current?.focus(); }
  }, [open]);

  const pick = (v: number | string) => { onChange(String(v)); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) pick(filtered[active].value); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <Field label={label} error={error}>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(o => !o)}
          className={cn(inputClasses(false, !!error), 'flex items-center justify-between text-left cursor-pointer')}
        >
          <span className={cn('truncate', !selected && 'text-ink-faint')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 text-ink-faint" aria-hidden />
        </button>

        {open && (
          <div className="absolute top-full z-(--z-dropdown) mt-1.5 max-h-64 w-full overflow-hidden rounded-xl
                          border border-border bg-surface-raised shadow-lg animate-fade-in">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder="Search..."
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <ul className="max-h-52 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <li className="px-3.5 py-2 text-sm text-ink-faint">{emptyMessage}</li>
              )}
              {filtered.map((o, i) => {
                const isSelected = String(o.value) === String(value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o.value)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors',
                        i === active ? 'bg-surface-sunken' : 'hover:bg-surface-sunken',
                        isSelected ? 'font-semibold text-primary' : 'text-ink',
                      )}
                    >
                      <span className="truncate">{o.label}</span>
                      {isSelected && <Check className="size-4 shrink-0" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Field>
  );
};

export default SearchableSelect;
