import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Check, ClipboardList, Star, UsersRound } from 'lucide-react';
import type { ProgressBar as Bar, TodayView } from '../../api/today';
import { Card, Figures } from '../ui';
import { cn } from '../../utils/cn';
import MyBabiesGrowth from './MyBabiesGrowth';

/** Whole-number percent, or null when there is nothing to divide by. */
const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * One form's bar: filled to what is done, with a mark where "expected by
 * today" falls. The bar runs to what is expected by today plus what falls
 * due in the next 7 days, so the mark shows how far along she should be.
 */
const FormBar: React.FC<{ bar: Bar }> = ({ bar }) => {
  const { t } = useTranslation('dashboard');
  const scale = Math.max(bar.expected + bar.soon, bar.done, 1);
  const behind = bar.done < bar.expected;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-ink">{t(`field.progress.bar.${bar.key}`)}</span>
        <span className="shrink-0 font-semibold tabular-nums text-ink">
          {bar.done} <span className="font-normal text-ink-muted">/ {bar.expected}</span>
        </span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div
          className={cn('h-full rounded-full', behind ? 'bg-amber-500' : 'bg-success-500')}
          style={{ width: `${Math.min(100, (bar.done / scale) * 100)}%` }}
        />
        {bar.expected > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-ink"
            style={{ left: `calc(${Math.min(100, (bar.expected / scale) * 100)}% - 1px)` }}
          />
        )}
      </div>
      {bar.soon > 0 && <span className="text-xs text-ink-muted">{t('field.progress.soon', { count: bar.soon })}</span>}
    </li>
  );
};

/** "Pregnant 4 / 4 ✓" — one adoption type against its target. */
const AdoptionLine: React.FC<{ type: string; adopted: number; target: number }> = ({ type, adopted, target }) => {
  const { t } = useTranslation('dashboard');
  const full = target > 0 && adopted >= target;
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-ink">{t(`field.adopt.${type}`)}</span>
      <span className={cn('flex shrink-0 items-center gap-1 font-semibold tabular-nums',
        full ? 'text-success-600 dark:text-success-500' : 'text-ink')}>
        {adopted} / {target}{full && <Check className="size-4" aria-hidden />}
      </span>
    </li>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }> = ({ icon, children, aside }) => (
  <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
    {icon}<span className="flex-1">{children}</span>{aside}
  </h2>
);

/**
 * "My progress" (Learner Redesign review, 30 Oct 2026): where she stands —
 * her babies' growth on top, then visits made against visits due (and on
 * time), adoptions against her targets, each form's done against expected
 * by today, and this week's forms with whom to finish to be back on track.
 * The To do tab stays free of numbers (launch review of 19 Oct 2026).
 */
const MyProgress: React.FC<{ view: TodayView }> = ({ view }) => {
  const { t } = useTranslation('dashboard');
  const progress = view.progress;
  const visits = progress?.visits ?? null;
  const adopted = view.targets.reduce((n, x) => n + x.adopted, 0);
  const target = view.targets.reduce((n, x) => n + x.target, 0);
  const week = progress?.week;
  const onTime = visits ? pct(visits.on_time, visits.made) : null;
  const forms = progress?.forms ?? [];

  return (
    <div className="flex flex-col gap-6">
      <MyBabiesGrowth />

      {visits && visits.due > 0 && (
        <section className="flex flex-col gap-2.5">
          <SectionTitle icon={<CalendarCheck className="size-5 text-primary-ink" />}>{t('field.progress.visitsTitle')}</SectionTitle>
          <Figures
            columns={3}
            items={[
              { label: t('field.progress.visitsDone'), value: visits.made },
              { label: t('field.progress.visitsExpected'), value: visits.due },
              {
                label: t('field.progress.onTime'),
                value: onTime != null ? `${onTime}%` : '—',
                hint: `${visits.on_time} / ${visits.made}`,
                tone: onTime == null ? undefined : onTime >= 80 ? 'success' : onTime >= 50 ? 'warning' : 'danger',
              },
            ]}
          />
          <p className="text-xs text-ink-muted">{t('field.progress.visitsHint')}</p>
        </section>
      )}

      {view.targets.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <SectionTitle icon={<UsersRound className="size-5 text-success-600" />}>
            {t('field.progress.adoptions', { adopted, target })}
          </SectionTitle>
          <Card className="px-4 py-1">
            <ul className="divide-y divide-border">
              {view.targets.map(x => <AdoptionLine key={x.type} type={x.type} adopted={x.adopted} target={x.target} />)}
            </ul>
          </Card>
        </section>
      )}

      {forms.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <SectionTitle
            icon={<ClipboardList className="size-5 text-primary-ink" />}
            aside={(
              <span className="flex items-center gap-1.5 text-xs font-normal text-ink-muted">
                <span aria-hidden className="inline-block h-3 w-0.5 bg-ink" />{t('field.progress.formsLegend')}
              </span>
            )}
          >
            {t('field.progress.formsTitle')}
          </SectionTitle>
          <Card className="p-4">
            <ul className="flex flex-col gap-4">{forms.map(b => <FormBar key={b.key} bar={b} />)}</ul>
          </Card>
        </section>
      )}

      {week && week.due > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          <Star className="mt-0.5 size-5 shrink-0 fill-amber-400 text-amber-500" />
          <span>
            {t('field.progress.week', { done: week.done, due: week.due })}{' '}
            {week.finish.length === 0
              ? t('field.progress.onTrack')
              : week.more > 0
                ? t('field.progress.finishMore', { names: week.finish.join(', '), count: week.more })
                : t('field.progress.finish', { names: week.finish.join(t('field.adoptPrompt.and')) })}
          </span>
        </p>
      )}

      {!visits && forms.length === 0 && view.targets.length === 0 && (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink-muted">{t('field.progress.nothing')}</p>
      )}
    </div>
  );
};

export default MyProgress;
