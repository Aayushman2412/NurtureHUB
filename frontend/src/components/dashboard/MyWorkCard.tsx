import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Baby, CalendarClock, ChevronRight, ClipboardList, HeartHandshake } from 'lucide-react';
import type { CaseWarning, FormCounts, MyWork, MyWorkCase } from '../../api/myWork';
import { Card, ProgressBar } from '../ui';
import { cn } from '../../utils/cn';

const FORM_KEYS: (keyof FormCounts)[] = ['gm', 'bf', 'cf', 'anc', 'protein'];
const TYPES = ['anc', 'pnc_lt5', 'pnc_ge5'] as const;

const pctOf = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);

/** "2 growth checks, 1 breastfeeding" — the forms in a count map. */
const FormList: React.FC<{ counts: FormCounts; tone: 'behind' | 'due' }> = ({ counts, tone }) => {
  const { t } = useTranslation('dashboard');
  const parts = FORM_KEYS.filter(k => counts[k] > 0);
  if (!parts.length) return null;
  return (
    <span className={cn('text-[13px]', tone === 'behind' ? 'text-error-600 dark:text-error-300' : 'text-amber-700 dark:text-amber-300')}>
      {parts.map(k => t(`work.forms.${k}`, { count: counts[k] })).join(', ')}
    </span>
  );
};

/** One supervisors' warning, in words the learner can act on. */
const Warning: React.FC<{ w: CaseWarning }> = ({ w }) => {
  const { t } = useTranslation('dashboard');
  const text = t(`work.warn.${w.code}`, {
    days: w.days_past_edd ?? w.days_since_visit ?? 0, done: w.anc_done ?? 0, expected: w.anc_expected ?? 0,
    n: w.visits_missed ?? 0,
    declared: w.declared ? t(`work.types.${w.declared}`, { defaultValue: w.declared }) : '',
    computed: w.computed ? t(`work.types.${w.computed}`, { defaultValue: w.computed }) : '',
  });
  return (
    <span className="mr-1.5 mt-1 inline-flex items-center gap-1 rounded-md bg-error-50 px-1.5 py-0.5 text-xs font-semibold text-error-700 dark:bg-error-500/15 dark:text-error-300">
      <AlertTriangle className="size-3" />{text}
    </span>
  );
};

/** How many faltering cases show before "Show all". */
const FIRST = 8;

const caseLink = (c: MyWorkCase) =>
  c.children[0] ? `/growth/cases/${c.children[0].id}?from=dashboard` : `/mothers/${c.mother_id}`;

/**
 * My work (review of 17 Oct 2026, Sir: "easy for them to track their own
 * activities and adoptions … what percentage of work is done, or what is
 * expected of them in the next few days"). The learner's own numbers from the
 * MASD rules: adoptions against the target, forms done against forms due for
 * the cases they adopted, and per mother what is behind and what falls due
 * soon. A baby whose latest measurement is severely low blinks.
 */
const MyWorkCard: React.FC<{ work: MyWork }> = ({ work }) => {
  const { t } = useTranslation('dashboard');
  const targets = work.targets!;
  const adoptions = work.adoptions!;
  const own = work.own!;
  const cases = work.cases ?? [];
  const [showAll, setShowAll] = useState(false);
  // Every faltering case — none hidden (review of 17 Oct 2026) — then the
  // cases that are fine now but have forms falling due soon.
  const faltering = cases.filter(c => c.faltering);
  const comingUp = cases.filter(c => !c.faltering && c.upcoming_total > 0);
  const shown = showAll ? faltering : faltering.slice(0, FIRST);
  const formsPct = own.pct != null ? Math.round(own.pct)
    : (own.expected.total ? pctOf(own.actual.total, own.expected.total) : null);

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <HeartHandshake className="size-5 text-primary-ink" />{t('work.title')}
      </h3>
      <p className="mb-4 text-sm text-ink-muted">{t('work.subtitle', { project: work.project?.name })}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-surface-sunken/60 p-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Baby className="size-4" />{t('work.adoptions')}</span>
            <span className="text-sm font-bold tabular-nums text-ink">
              {targets.total ? t('work.ofTarget', { n: adoptions.total, of: targets.total }) : adoptions.total}
            </span>
          </div>
          {targets.total > 0 && <ProgressBar value={pctOf(adoptions.total, targets.total)} tone="sage" />}
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {TYPES.map(k => (
              <span key={k} className="rounded-full bg-surface px-2 py-0.5 text-ink-muted ring-1 ring-border">
                {t(`work.types.${k}`)}: <b className="text-ink">{adoptions[k]}{targets[k] ? `/${targets[k]}` : ''}</b>
              </span>
            ))}
          </div>
          {!targets.total && <p className="mt-2 text-xs text-ink-faint">{t('work.noTarget')}</p>}
        </div>

        <div className="rounded-xl bg-surface-sunken/60 p-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><ClipboardList className="size-4" />{t('work.forms.title')}</span>
            <span className="text-sm font-bold tabular-nums text-ink">
              {own.expected.total ? t('work.ofDue', { n: own.actual.total, of: own.expected.total }) : own.actual.total}
            </span>
          </div>
          {own.expected.total > 0 && <ProgressBar value={formsPct ?? 0} tone={(formsPct ?? 0) >= 80 ? 'sage' : (formsPct ?? 0) >= 50 ? 'amber' : 'coral'} />}
          <p className="mt-2 text-xs text-ink-muted">
            {own.expected.total ? t('work.formsPct', { pct: formsPct ?? 0 }) : t('work.noFormsDue')}
          </p>
          {work.nil_days != null && work.nil_days > 7 && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-error-600 dark:text-error-300">
              <AlertTriangle className="size-3.5" />{t('work.quiet', { days: work.nil_days })}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
          <AlertTriangle className="size-4" />{t('work.faltering', { count: faltering.length })}
        </h4>
        {faltering.length === 0 ? (
          <p className="rounded-lg bg-surface-sunken/60 px-3 py-3 text-sm text-ink-muted">
            {cases.length ? t('work.noneFaltering') : t('work.noCases')}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {shown.map(c => (
              <li key={c.mother_id}>
                <Link to={caseLink(c)} className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-sunken/60">
                  <span className="relative mt-1.5 flex size-2.5 shrink-0" aria-hidden>
                    {(c.severe || c.growth_alert) && (
                      <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-75', c.severe ? 'bg-error-500' : 'bg-amber-500')} />
                    )}
                    <span className={cn('relative inline-flex size-2.5 rounded-full',
                      c.severe ? 'bg-error-500' : c.growth_alert || c.behind_total ? 'bg-amber-500' : 'bg-sage-500')} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {c.mother_name}
                      {c.children.length > 0 && <span className="font-normal text-ink-muted"> · {c.children.map(k => k.name || t('work.baby')).join(', ')}</span>}
                    </span>
                    {c.warnings.length > 0 && <span className="block">{c.warnings.map((w, i) => <Warning key={i} w={w} />)}</span>}
                    {c.children.flatMap(k => k.alerts).map((a, i) => (
                      <span key={i} className={cn('mr-2 inline-block text-[13px] font-semibold', a.severe ? 'text-error-600 dark:text-error-300' : 'text-amber-700 dark:text-amber-300')}>
                        {t('work.growthAlert', { label: a.label })}
                      </span>
                    ))}
                    {c.behind_total > 0 && <span className="block"><span className="text-[13px] text-ink-muted">{t('work.behind')} </span><FormList counts={c.behind} tone="behind" /></span>}
                    {c.upcoming_total > 0 && <span className="block"><span className="text-[13px] text-ink-muted">{t('work.dueSoon', { days: work.due_days ?? 7 })} </span><FormList counts={c.upcoming} tone="due" /></span>}
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {faltering.length > FIRST && (
          <button type="button" onClick={() => setShowAll(v => !v)}
            className="mt-2 cursor-pointer text-sm font-semibold text-primary-ink hover:text-primary-ink-hover">
            {showAll ? t('work.showFewer') : t('work.showAll', { n: faltering.length })}
          </button>
        )}
      </div>

      {comingUp.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
            <CalendarClock className="size-4" />{t('work.nextDays', { days: work.due_days ?? 7 })}
          </h4>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {comingUp.map(c => (
              <li key={c.mother_id}>
                <Link to={caseLink(c)} className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-sunken/60">
                  <span className="mt-1.5 inline-flex size-2.5 shrink-0 rounded-full bg-sage-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{c.mother_name}</span>
                    <span className="block"><span className="text-[13px] text-ink-muted">{t('work.dueSoon', { days: work.due_days ?? 7 })} </span><FormList counts={c.upcoming} tone="due" /></span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default MyWorkCard;
