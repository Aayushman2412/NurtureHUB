import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '../../utils/cn';
import { inputClasses } from './Input';

export interface DateInputProps {
  /** ISO value 'yyyy-mm-dd' (or '' when empty) — the form state stays ISO. */
  value: string;
  /** Called with an ISO 'yyyy-mm-dd' (or '' when cleared/incomplete). */
  onChange: (iso: string) => void;
  id?: string;
  /** ISO bounds passed through to the native picker. */
  max?: string;
  min?: string;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
}

// ISO 'yyyy-mm-dd' -> display 'dd/mm/yyyy'
const isoToDisplay = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

// display 'dd/mm/yyyy' -> ISO 'yyyy-mm-dd' (only for a real, complete date; else '')
const displayToIso = (s: string): string => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return '';
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';  // reject 31/02 etc.
  return `${m[3]}-${m[2]}-${m[1]}`;
};

// mask raw keystrokes into 'dd/mm/yyyy' as the user types
const mask = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
};

/**
 * A DD/MM/YYYY date field. The native <input type="date"> renders in the browser's
 * locale (often MM/DD/YYYY), which can't be overridden — so this shows a masked text
 * input in DD/MM/YYYY and keeps the native calendar via a picker button. The value
 * exchanged with the form is always ISO 'yyyy-mm-dd', so validation is unchanged.
 */
const DateInput: React.FC<DateInputProps> = ({
  value, onChange, id, max, min, disabled, error, placeholder = 'DD/MM/YYYY',
}) => {
  const [text, setText] = useState(() => isoToDisplay(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  // Sync display when the value changes from outside (prefill/reset/picker) — but not
  // while the user is mid-typing (guard: skip when our own text already maps to `value`).
  useEffect(() => {
    if (displayToIso(text) !== value) setText(isoToDisplay(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleText = (raw: string) => {
    const masked = mask(raw);
    setText(masked);
    const iso = displayToIso(masked);
    if (iso || masked === '') onChange(iso);   // commit a complete date, or clear; ignore partials
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') { try { el.showPicker(); return; } catch { /* fall through */ } }
    el.focus();
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => handleText(e.target.value)}
        className={cn(inputClasses(false, !!error), 'pr-10')}
      />
      {/* Hidden native date input — fills the field so the picker anchors correctly. */}
      <input
        ref={pickerRef}
        type="date"
        value={value}
        max={max}
        min={min}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0"
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Open calendar"
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center rounded-r-lg
                   text-ink-faint hover:text-ink disabled:opacity-50"
      >
        <Calendar className="size-4" />
      </button>
    </div>
  );
};

export default DateInput;
