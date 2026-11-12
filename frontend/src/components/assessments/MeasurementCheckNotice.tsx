import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, RotateCcw } from 'lucide-react';
import type { CheckCode, CheckFlag } from '../../api/growthStatus';
import { Button } from '../ui';
import { cn } from '../../utils/cn';
import { formatDisplayDate } from './flowRunner';

/** Care advice stays on screen after the value is confirmed; "measure again" does not. */
const ADVICE: CheckFlag['action'][] = ['refer_today', 'revisit_7d'];

/** One flag in words, with the numbers it was found from. */
const message = (f: CheckFlag, t: (k: string, o?: Record<string, unknown>) => string, language: string): string =>
  t(`checks.${f.code}`, {
    previous: f.previous?.value,
    date: f.previous ? formatDisplayDate(f.previous.on, language) : '',
    pct: f.loss_pct,
    days: f.revisit_within_days,
    birth: f.birth_weight,
    cm: f.shorter_cm,
  });

/**
 * The measurement checks for one field of the growth check (visit protocol,
 * Nov 2026; the rules are the server's, app/growth_entry_checks.py), shown
 * right under the weight or length: what looks wrong, and two answers —
 * measure again, or the value is right. A confirmed value is saved as it is,
 * with the flag recorded for the supervisors; refer / revisit advice stays.
 */
const MeasurementCheckNotice: React.FC<{
  field: CheckFlag['field'];
  flags: CheckFlag[];
  confirmed: CheckCode[];
  onRemeasure: () => void;
  onConfirm: () => void;
}> = ({ field, flags, confirmed, onRemeasure, onConfirm }) => {
  const { t, i18n } = useTranslation('assessments');
  if (flags.length === 0) return null;
  const done = flags.every(f => confirmed.includes(f.code));
  const refer = flags.some(f => f.action === 'refer_today');
  const shown = done ? flags.filter(f => ADVICE.includes(f.action)) : flags;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('-mt-2 rounded-md border-l-[3px] bg-surface-sunken px-3.5 py-3',
        refer ? 'border-l-error-500' : 'border-l-amber-500')}
    >
      {done ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Check className="size-4 shrink-0 text-success-600" />{t('checks.confirmed')}
        </p>
      ) : (
        <p className={cn('flex items-center gap-2 text-sm font-semibold',
          refer ? 'text-error-600 dark:text-error-400' : 'text-amber-700 dark:text-amber-400')}>
          <AlertTriangle className="size-4 shrink-0" />{t(field === 'weight' ? 'checks.titleWeight' : 'checks.titleLength')}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 text-sm text-ink">
          {shown.map(f => <li key={f.code}>{message(f, t, i18n.language)}</li>)}
        </ul>
      )}
      {!done && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onRemeasure} iconLeft={<RotateCcw className="size-4" />}>
            {t('checks.remeasure')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onConfirm} iconLeft={<Check className="size-4" />}>
            {t('checks.confirm')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default MeasurementCheckNotice;
