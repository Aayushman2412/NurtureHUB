import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Field } from './Field';
import { inputClasses } from './Input';

export interface ComboBoxOption {
  value: number | string;
  label: string;
}

export interface ComboBoxProps {
  label: string;
  /** The current display text (a picked option's label, or free-typed text). */
  value: string;
  /** User typed free text (i.e. an entry that may not be in the list). */
  onValueChange: (text: string) => void;
  /** User selected a known option from the list. */
  onPick: (option: ComboBoxOption) => void;
  options: ComboBoxOption[];
  placeholder: string;
  disabled?: boolean;
  error?: string;
}

/**
 * An editable combobox: type freely OR pick from a filtered dropdown. Unlike
 * SearchableSelect (which forces a selection), a typed value that matches no option
 * is kept as-is — used for the LR village field, where the master list may be
 * incomplete so learners can enter a village by name.
 */
const ComboBox: React.FC<ComboBoxProps> = ({
  label, value, onValueChange, onPick, options, placeholder, disabled = false, error,
}) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, value]);

  const exactMatch = options.some(o => o.label.toLowerCase() === value.trim().toLowerCase());

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const pick = (o: ComboBoxOption) => { onPick(o); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && filtered[active]) pick(filtered[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <Field label={label} error={error}>
      <div ref={rootRef} className="relative">
        <div className="relative">
          <input
            type="text"
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={e => { onValueChange(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(inputClasses(false, !!error), 'pr-9')}
          />
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
        </div>

        {open && !disabled && (
          <div className="absolute top-full z-(--z-dropdown) mt-1.5 max-h-64 w-full overflow-hidden rounded-xl
                          border border-border bg-surface-raised shadow-lg animate-fade-in">
            <ul className="max-h-64 overflow-y-auto py-1">
              {filtered.map((o, i) => {
                const isSelected = o.label.toLowerCase() === value.trim().toLowerCase();
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors',
                        i === active ? 'bg-surface-sunken' : 'hover:bg-surface-sunken',
                        isSelected ? 'font-semibold text-primary-ink' : 'text-ink',
                      )}
                    >
                      <span className="truncate">{o.label}</span>
                      {isSelected && <Check className="size-4 shrink-0" aria-hidden />}
                    </button>
                  </li>
                );
              })}
              {value.trim() && !exactMatch && (
                <li className="border-t border-border px-3.5 py-2 text-xs text-ink-faint">
                  Not in the list — “{value.trim()}” will be saved as entered.
                </li>
              )}
              {filtered.length === 0 && !value.trim() && (
                <li className="px-3.5 py-2 text-sm text-ink-faint">Start typing to search or add a village</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </Field>
  );
};

export default ComboBox;
