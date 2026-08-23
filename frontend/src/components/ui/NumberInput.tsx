import React, { useEffect, useState } from 'react';
import Input, { type InputProps } from './Input';

export interface NumberInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type'> {
  /** The committed numeric value. */
  value: number;
  /** Fired only with a usable number — never mid-edit while the box is blank. */
  onChange: (value: number) => void;
  /** What an emptied box falls back to when the user leaves it. */
  fallback: number;
  min?: number;
  max?: number;
}

/**
 * A numeric field you can actually clear.
 *
 * The obvious `value={n} onChange={parseInt(e.target.value) || fallback}` is a
 * trap: `parseInt('')` is NaN, so the moment you select-all and delete, the
 * fallback is written straight back into the box. Editing "3" into "60" then
 * means dragging the caret in front of the 3, typing 60, and deleting the
 * stranded digit — which is exactly what the team reported.
 *
 * The fix is a local draft string. While the field is being edited it can hold
 * '' or '-' or any half-typed number; the parent only hears about valid values.
 * On blur an empty/invalid draft snaps to `fallback` and is committed, so the
 * form never submits a NaN.
 */
const NumberInput: React.FC<NumberInputProps> = ({
  value, onChange, fallback, min, max, onBlur, ...rest
}) => {
  const [draft, setDraft] = useState<string>(String(value));
  const [editing, setEditing] = useState(false);

  // Track external updates (a reload, a reset), but never yank the box out from
  // under someone who is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const clamp = (n: number) => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };

  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      value={draft}
      onFocus={e => {
        setEditing(true);
        rest.onFocus?.(e);
      }}
      onChange={e => {
        const raw = e.target.value;
        // Allow the empty string and a lone '-' so the box can be cleared and
        // retyped; anything else must look like a number before it is committed.
        if (raw !== '' && raw !== '-' && !/^-?\d*\.?\d*$/.test(raw)) return;
        setDraft(raw);
        const n = Number(raw);
        if (raw !== '' && raw !== '-' && Number.isFinite(n)) onChange(clamp(n));
      }}
      onBlur={e => {
        setEditing(false);
        const n = Number(draft);
        const next = draft.trim() === '' || !Number.isFinite(n) ? fallback : clamp(n);
        setDraft(String(next));
        if (next !== value) onChange(next);
        onBlur?.(e);
      }}
    />
  );
};

export default NumberInput;
