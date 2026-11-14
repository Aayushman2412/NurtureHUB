import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CalendarDays, ChevronRight } from 'lucide-react';
import type { FormCode } from '../../api/today';
import type { ChildVisitPlan, FormTag, PlannedVisit } from '../../api/visits';
import { formsForNow } from '../../lib/visitProtocol';
import { Badge, buttonClasses, Card } from '../ui';
import { dayMonth, localIso, shortDay, sortForms, visitUrl } from './fieldText';
import VisitTimeline from './VisitTimeline';

/** "Day 5" or "CF-3": which visit of the protocol this is. */
const visitLabel = (v: PlannedVisit, t: TFunction): string =>
  v.cf_no != null ? t('field.protocol.cfN', { n: v.cf_no }) : v.day != null ? t('field.protocol.dayN', { day: v.day }) : '';

/** About how long each form takes at a visit, for "3 forms · about 15 min". */
const FORM_MINUTES: Record<FormCode, number> = { gm: 5, bf: 6, cf: 5, anc: 6, protein: 5 };

/** Why a form is on the visit, in words: "Every visit", "Catch-up 4 of 5", "CF-1". */
export const tagText = (tag: FormTag | undefined, t: TFunction): string | null => {
  if (!tag) return null;
  switch (tag.kind) {
    case 'count':
    case 'catch_up':
      return t(`field.tag.${tag.kind}`, { n: tag.n, of: tag.of });
    case 'cf':
      return t('field.tag.cf', { n: tag.n });
    default:
      return t(`field.tag.${tag.kind}`);
  }
};

/**
 * One baby's visits under the November 2026 protocol (docs/visit-protocol-2026-11.md),
 * as the Learner Redesign review drew it (30 Oct 2026): the visit line with
 * "Visit 8 of 17 due today · 6 done, 1 missed", the forms of the visit each
 * with why it is there, "Start visit 8", the visits after it, and where the
 * breastfeeding and protein forms stand.
 */
const VisitPlanCard: React.FC<{ plan: ChildVisitPlan; motherId: number; childId: number }> = ({ plan, motherId, childId }) => {
  const { t } = useTranslation('dashboard');
  const next = plan.next ?? null;
  const now = sortForms(formsForNow(plan));
  const due = next != null && next.due_on <= localIso();
  const tags = (due ? (plan.today?.tags ?? next?.tags) : next?.tags) ?? {};
  const shownForms = due ? now : sortForms(next?.forms ?? now);
  const minutes = shownForms.reduce((n, f) => n + (FORM_MINUTES[f] ?? 5), 0);
  const current = plan.timeline?.current ?? null;
  const hidden = plan.bf?.hidden_questions.length ?? 0;
  const bfLine = plan.bf && plan.bf.status !== 'not_applicable' ? t(`field.protocol.bf.${plan.bf.status}`, { defaultValue: '' }) : '';
  const pfLine = plan.pf?.stopped ? t('field.protocol.pf.stopped')
    : plan.pf?.next_on ? t('field.protocol.pf.next', { date: shortDay(plan.pf.next_on) }) : '';
  const later = (plan.later ?? []).map(v =>
    `${dayMonth(v.due_on)} – ${visitLabel(v, t) || sortForms(v.forms).map(f => t(`field.form.${f}`)).join(', ')}`);
  const late = next != null && next.late_days > 0;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
          <CalendarDays className="size-5 text-primary-ink" />{t('field.timeline.title')}
        </h2>
        {current && (
          <p className="text-sm text-ink">
            <b>{t('field.timeline.counter', { n: current.n, total: current.total })}</b>{' '}
            {current.state === 'due' ? (
              <b className={late ? 'text-error-600 dark:text-error-400' : 'text-amber-700 dark:text-amber-400'}>
                {late ? t('field.lateBy', { count: next!.late_days }) : t('field.timeline.dueToday')}
              </b>
            ) : next && <span className="text-ink-muted">{t('field.timeline.nextOn', { date: shortDay(next.due_on) })}</span>}
            <span className="text-ink-muted">
              {' · '}{t('field.timeline.summary_done', { count: current.done })}
              {current.missed > 0 && (
                <>, <span className="font-semibold text-error-600 dark:text-error-400">{t('field.timeline.summary_missed', { count: current.missed })}</span></>
              )}
            </span>
          </p>
        )}
      </div>

      {plan.timeline && plan.timeline.lines.length > 0 && <VisitTimeline timeline={plan.timeline} />}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {next ? (
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-semibold text-ink">
              {due ? t('field.visitCard.todaysForms') : `${t('field.baby.nextVisit')} · ${shortDay(next.due_on)}`}
              {visitLabel(next, t) && <span className="font-normal text-ink-muted"> · {visitLabel(next, t)}</span>}
            </span>
            <span className="text-xs text-ink-muted">{t('field.visitCard.forms', { count: shownForms.length, min: minutes })}</span>
          </p>
        ) : (
          <p className="text-sm text-ink-muted">{t('field.protocol.noVisit')}</p>
        )}
        <ol className="flex flex-col gap-1.5">
          {shownForms.map((f, i) => {
            const tag = tagText(tags[f], t);
            const warn = tags[f]?.kind === 'catch_up' || tags[f]?.kind === 'reopened';
            return (
              <li key={f} className="flex items-center gap-2.5 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold tabular-nums text-ink-muted">{i + 1}</span>
                <span className="flex-1 font-semibold text-ink">{t(`field.form.${f}`)}</span>
                {tag && <Badge variant={warn ? 'warning' : 'neutral'}>{tag}</Badge>}
              </li>
            );
          })}
        </ol>
      </div>

      <Link to={visitUrl(motherId, childId, now)} className={buttonClasses('primary', 'lg', 'w-full')}>
        {current && current.state === 'due' ? t('field.timeline.start', { n: current.n }) : t('field.baby.startVisit')}
        <ChevronRight className="size-5" />
      </Link>

      {later.length > 0 && (
        <p className="text-xs leading-relaxed text-ink-muted">{t('field.visitCard.nextVisits', { list: later.join(' · ') })}</p>
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
