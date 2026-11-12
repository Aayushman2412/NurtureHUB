import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CalendarDays, ChevronRight } from 'lucide-react';
import type { ChildVisitPlan, PlannedVisit } from '../../api/visits';
import { formsForNow } from '../../lib/visitProtocol';
import { buttonClasses, Card } from '../ui';
import { formNames, shortDay, visitUrl } from './fieldText';

/** "Day 5" or "CF-3": which visit of the protocol this is. */
const visitLabel = (v: PlannedVisit, t: TFunction): string =>
  v.cf_no != null ? t('field.protocol.cfN', { n: v.cf_no }) : v.day != null ? t('field.protocol.dayN', { day: v.day }) : '';

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * One baby's visits under the November 2026 protocol (docs/visit-protocol-2026-11.md):
 * the next visit with its forms, "Start visit", the visits after it, and
 * where the breastfeeding and protein forms stand.
 */
const VisitPlanCard: React.FC<{ plan: ChildVisitPlan; motherId: number; childId: number }> = ({ plan, motherId, childId }) => {
  const { t } = useTranslation('dashboard');
  const next = plan.next ?? null;
  const now = formsForNow(plan);
  const due = next != null && next.due_on <= todayIso();
  const hidden = plan.bf?.hidden_questions.length ?? 0;
  const bfLine = plan.bf && plan.bf.status !== 'not_applicable' ? t(`field.protocol.bf.${plan.bf.status}`, { defaultValue: '' }) : '';
  const pfLine = plan.pf?.stopped ? t('field.protocol.pf.stopped')
    : plan.pf?.next_on ? t('field.protocol.pf.next', { date: shortDay(plan.pf.next_on) }) : '';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
        <CalendarDays className="size-5 text-primary-ink" />{t('field.baby.nextVisit')}
      </h2>
      {next ? (
        <p className="text-sm text-ink">
          <b className={due ? (next.late_days > 0 ? 'text-error-600 dark:text-error-400' : 'text-amber-700 dark:text-amber-400') : ''}>
            {due ? (next.late_days > 0 ? t('field.lateBy', { count: next.late_days }) : t('field.dueToday')) : shortDay(next.due_on)}
          </b>
          {visitLabel(next, t) && <span className="text-ink-muted"> · {visitLabel(next, t)}</span>}
          {' — '}{formNames(next.forms, t)}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">{t('field.protocol.noVisit')}</p>
      )}
      <Link to={visitUrl(motherId, childId, now)} className={buttonClasses('primary', 'lg', 'w-full')}>
        {t('field.baby.startVisit')}<ChevronRight className="size-5" />
      </Link>
      <p className="text-center text-xs text-ink-muted">{t('field.baby.visitIs', { forms: formNames(now, t) })}</p>

      {(plan.later?.length ?? 0) > 0 && (
        <div className="border-t border-border pt-3">
          <h3 className="mb-1.5 text-sm font-semibold text-ink">{t('field.protocol.plan')}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {plan.later!.map(v => (
              <li key={v.due_on} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold tabular-nums text-ink">{shortDay(v.due_on)}</span>
                {visitLabel(v, t) && <span className="text-xs text-ink-muted">{visitLabel(v, t)}</span>}
                <span className="text-ink-muted">{formNames(v.forms, t)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(bfLine || pfLine || hidden > 0) && (
        <ul className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-ink-muted">
          {bfLine && <li>{bfLine}</li>}
          {hidden > 0 && <li>{t('field.protocol.hidden', { count: hidden })}</li>}
          {pfLine && <li>{pfLine}</li>}
        </ul>
      )}
    </Card>
  );
};

export default VisitPlanCard;
