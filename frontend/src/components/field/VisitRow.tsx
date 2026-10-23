import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { TaskGroup } from '../../api/today';
import { buttonClasses } from '../ui';
import { cn } from '../../utils/cn';
import { formNames, visitUrl, whoLine } from './fieldText';

/** One visit to make: who, which forms, late or today — the whole row starts it. */
const VisitRow: React.FC<{ g: TaskGroup }> = ({ g }) => {
  const { t } = useTranslation('dashboard');
  const who = whoLine(g, t);
  const late = g.late_days > 0;
  return (
    <Link
      to={visitUrl(g.mother_id, g.child_id, g.forms.map(f => f.key))}
      className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-(--shadow-card) transition-colors hover:border-border-strong active:bg-surface-sunken"
    >
      <span className={cn('size-3 shrink-0 rounded-full', late ? 'bg-error-500' : 'bg-amber-500')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate font-display text-base font-bold text-ink">{who.name}</span>
          <span className="text-xs text-ink-muted">{who.sub}</span>
        </span>
        <span className="block text-sm text-ink">{formNames(g.forms.map(f => f.key), t)}</span>
        <span className={cn('text-xs font-bold', late ? 'text-error-600 dark:text-error-400' : 'text-amber-700 dark:text-amber-400')}>
          {late ? (g.late_days <= 30 ? t('field.lateBy', { count: g.late_days }) : t('field.late')) : t('field.dueToday')}
        </span>
      </span>
      <span className={buttonClasses('primary', 'sm', 'shrink-0 pointer-events-none')}>
        {t('field.start')}<ChevronRight className="size-4" />
      </span>
    </Link>
  );
};

export default VisitRow;
