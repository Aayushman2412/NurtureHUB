import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import Modal from './Modal';
import { cn } from '../../utils/cn';

/**
 * Year → month → day (review of 29–30 Oct 2026: "I must be able to select
 * the month, date and year"). The phone's own date dialog opened a date of
 * birth at "January 1" — the year 1 AD — because today lies past the field's
 * latest allowed date; three taps here reach any year without scrolling
 * through months.
 */
export interface DatePickerProps {
  open: boolean;
  /** ISO 'yyyy-mm-dd', or '' when nothing is chosen yet. */
  value: string;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}

type Step = 'year' | 'month' | 'day';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
};
const todayIso = () => {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth(), t.getDate());
};

const DatePicker: React.FC<DatePickerProps> = ({ open, value, min, max, onPick, onClose }) => {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';
  const today = todayIso();
  const lo = parse(min);
  const hi = parse(max);
  const picked = parse(value);
  const maxYear = hi?.y ?? new Date().getFullYear() + 5;
  const minYear = lo?.y ?? maxYear - 100;

  // Where the picker opens: the chosen date, else today, kept inside the
  // allowed range (a date of birth opens near its latest allowed year).
  const start = useMemo(() => {
    if (picked) return picked;
    if (hi && today > (max as string)) return hi;
    if (lo && today < (min as string)) return lo;
    return parse(today)!;
  }, [picked, today, min, max, lo, hi]);

  const [step, setStep] = useState<Step>(picked ? 'day' : 'year');
  const [year, setYear] = useState(start.y);
  const [month, setMonth] = useState(start.m);

  useEffect(() => {
    if (!open) return;
    setStep(picked ? 'day' : 'year');
    setYear(start.y);
    setMonth(start.m);
    // Reset each time it opens, not while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const yearRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open && step === 'year') yearRef.current?.scrollIntoView({ block: 'center' });
  }, [open, step]);

  const inRange = (d: string) => (!min || d >= min) && (!max || d <= max);
  const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  // A month is open when any of its days is allowed.
  const monthOpen = (y: number, m: number) =>
    (!min || iso(y, m, lastDay(y, m)) >= min) && (!max || iso(y, m, 1) <= max);

  const monthName = (m: number, style: 'short' | 'long') =>
    new Date(2000, m, 1).toLocaleDateString(locale, { month: style });
  // Monday first, as on the phones the workers use (1 Jan 2024 was a Monday).
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' })), [locale]);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = minYear; y <= maxYear; y += 1) out.push(y);
    return out;
  }, [minYear, maxYear]);

  const shiftTo = (by: number) => {
    const d = new Date(year, month + by, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  };
  const canShift = (by: number) => {
    const { y, m } = shiftTo(by);
    return y >= minYear && y <= maxYear && monthOpen(y, m);
  };
  const shiftMonth = (by: number) => {
    const { y, m } = shiftTo(by);
    setYear(y);
    setMonth(m);
  };

  const daysInMonth = lastDay(year, month);
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;   // blanks before the 1st

  const headline = picked
    ? new Date(picked.y, picked.m, picked.d).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : t('datePicker.none');

  const chip = (label: string, target: Step) => (
    <button
      type="button"
      onClick={() => setStep(target)}
      aria-pressed={step === target}
      className={cn(
        'inline-flex min-h-11 items-center gap-1 rounded-full border px-3.5 text-base font-bold transition-colors',
        step === target ? 'border-primary bg-coral-50 text-primary-ink dark:bg-coral-500/15' : 'border-border text-ink hover:bg-surface-sunken',
      )}
    >
      {label}<ChevronDown className="size-4" />
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} size="sm" title={t('datePicker.title')}
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          {inRange(today) ? (
            <button type="button" onClick={() => onPick(today)} className="min-h-11 text-sm font-semibold text-primary-ink">
              {t('datePicker.today')}
            </button>
          ) : <span />}
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-semibold text-ink-muted hover:text-ink">
            {t('datePicker.cancel')}
          </button>
        </div>
      )}
    >
      <p className="mb-3 font-display text-2xl font-extrabold text-ink">{headline}</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chip(String(year), 'year')}
        {step !== 'year' && chip(monthName(month, 'short'), 'month')}
        <span className="text-sm text-ink-muted">
          {t(step === 'year' ? 'datePicker.pickYear' : step === 'month' ? 'datePicker.pickMonth' : 'datePicker.pickDay')}
        </span>
      </div>

      {step === 'year' && (
        <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1" role="listbox" aria-label={t('datePicker.pickYear')}>
          {years.map(y => {
            const current = y === year;
            return (
              <button
                key={y}
                ref={current ? yearRef : undefined}
                type="button"
                role="option"
                aria-selected={current}
                onClick={() => { setYear(y); setStep('month'); }}
                className={cn('min-h-11 rounded-lg text-base font-semibold tabular-nums transition-colors',
                  current ? 'bg-primary text-white' : 'text-ink hover:bg-surface-sunken')}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}

      {step === 'month' && (
        <div className="grid grid-cols-3 gap-2" role="listbox" aria-label={t('datePicker.pickMonth')}>
          {Array.from({ length: 12 }, (_, m) => {
            const current = m === month;
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={current}
                disabled={!monthOpen(year, m)}
                onClick={() => { setMonth(m); setStep('day'); }}
                className={cn('min-h-12 rounded-lg text-base font-semibold transition-colors disabled:opacity-30',
                  current ? 'bg-primary text-white' : 'text-ink hover:bg-surface-sunken')}
              >
                {monthName(m, 'short')}
              </button>
            );
          })}
        </div>
      )}

      {step === 'day' && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} disabled={!canShift(-1)} aria-label={t('datePicker.prevMonth')}
              className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-sunken disabled:opacity-30">
              <ChevronLeft className="size-5" />
            </button>
            <span className="font-semibold text-ink">{monthName(month, 'long')} {year}</span>
            <button type="button" onClick={() => shiftMonth(1)} disabled={!canShift(1)} aria-label={t('datePicker.nextMonth')}
              className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-sunken disabled:opacity-30">
              <ChevronRight className="size-5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink-muted">
            {weekdays.map((w, i) => <span key={i} className="py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const v = iso(year, month, d);
              const sel = v === value;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!inRange(v)}
                  onClick={() => onPick(v)}
                  aria-label={new Date(year, month, d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
                  aria-pressed={sel}
                  className={cn('flex aspect-square min-h-10 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors disabled:opacity-25',
                    sel ? 'bg-primary text-white' : v === today ? 'text-primary-ink ring-1 ring-primary' : 'text-ink hover:bg-surface-sunken')}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default DatePicker;
