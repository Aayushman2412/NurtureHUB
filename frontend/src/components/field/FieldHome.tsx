import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList, GraduationCap, HeartHandshake, Plus, Star,
  UsersRound, WifiOff,
} from 'lucide-react';
import { formRunUrl, getToday, type TodayView, type UrgentBaby } from '../../api/today';
import { flowString } from '../../lib/careFlow';
import { TONE_CLASSES } from '../../lib/babyStatus';
import { useAuth } from '../../context/AuthContext';
import { buttonClasses, Card, Skeleton } from '../ui';
import { cn } from '../../utils/cn';
import { formNames, shortDay, visitUrl, whoLine } from './fieldText';
import VisitRow from './VisitRow';
import TeamCallList from './TeamCallList';

/** Today's visits shown before "Show more" — the most late first. */
const FIRST_VISITS = 6;

const Section: React.FC<{ icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }> = ({
  icon, title, count, children,
}) => (
  <section className="flex flex-col gap-2.5">
    <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
      {icon}
      <span>{title}</span>
      {count != null && count > 0 && (
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-sm font-bold tabular-nums text-ink-muted">{count}</span>
      )}
    </h2>
    {children}
  </section>
);

/** A baby to see within 2 days: the reason in red or yellow; the row opens
 *  the baby, "Start" opens the visit. */
const UrgentRow: React.FC<{ u: UrgentBaby }> = ({ u }) => {
  const { t } = useTranslation('dashboard');
  const tone = TONE_CLASSES[u.status];
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border bg-surface p-3 shadow-(--shadow-card) ring-1', tone.ring,
      u.status === 'red' ? 'border-error-500/50' : 'border-amber-500/50')}>
      <Link to={`/babies/${u.child_id}`} className="flex min-w-0 flex-1 items-start gap-2.5">
        <AlertTriangle className={cn('mt-0.5 size-5 shrink-0', tone.text)} />
        <span className="min-w-0">
          <span className="block font-display text-base font-bold leading-snug text-ink">
            {t('field.urgent.see', { name: u.child_name || t('field.baby'), count: u.see_within_days })}
          </span>
          <span className={cn('block text-sm font-semibold', tone.text)}>{t(`field.reason.${u.reasons[0] ?? 'low_wfa'}`)}</span>
          <span className="block truncate text-xs text-ink-muted">{t('field.motherIs', { mother: u.mother_name })}</span>
        </span>
      </Link>
      <Link to={visitUrl(u.mother_id, u.child_id, u.forms)} className={buttonClasses('primary', 'sm', 'shrink-0')}>
        {t('field.start')}<ChevronRight className="size-4" />
      </Link>
    </div>
  );
};

/** "●●○ Pregnant mothers — adopt 1 more": the target as an instruction. */
const AdoptRow: React.FC<{ type: string; target: number; adopted: number; more: number }> = ({ type, target, adopted, more }) => {
  const { t } = useTranslation('dashboard');
  const dots = Math.max(target, adopted);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-sunken/70 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{t(`field.adopt.${type}`)}</p>
        {dots <= 12 ? (
          <p className="mt-1 flex flex-wrap gap-1" aria-label={t('field.adopt.ofTarget', { adopted, target })}>
            {Array.from({ length: dots }, (_, i) => (
              <span key={i} className={cn('size-3.5 rounded-full', i < adopted ? 'bg-success-500' : 'border-2 border-ink-faint')} />
            ))}
          </p>
        ) : (
          <p className="text-xs text-ink-muted">{t('field.adopt.ofTarget', { adopted, target })}</p>
        )}
      </div>
      {more > 0 ? (
        <span className="shrink-0 text-right text-sm font-bold text-primary-ink">{t('field.adopt.more', { count: more })}</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-success-600 dark:text-success-500">
          <Check className="size-4" />{t('field.adopt.done')}
        </span>
      )}
    </div>
  );
};

/**
 * The health worker's home once adoptions start (launch review of 19 Oct
 * 2026). The stakeholders: "as soon as they open the app, the app should tell
 * them — do this, do this"; "one after another"; no percentages, no
 * equations, no monitoring charts. So: register a mother, the babies to see
 * now, today's visits (one tap starts the forms in order), registrations to
 * finish, how many more to adopt, and what comes this week.
 */
const FieldHome: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const [view, setView] = useState<TodayView | null>(null);
  const [failed, setFailed] = useState(false);
  const [allVisits, setAllVisits] = useState(false);
  const [allFinish, setAllFinish] = useState(false);

  useEffect(() => {
    let alive = true;
    getToday().then(v => { if (alive) setView(v); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const firstName = (user?.full_name || '').trim().split(/\s+/)[0];
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const nothingToday = view && !view.urgent.length && !view.today.length && !view.finish.length;
  // A baby to see soon is already at the top with its own "Start visit".
  const urgentIds = new Set(view?.urgent.map(u => u.child_id));
  const visits = (view?.today ?? []).filter(g => g.child_id == null || !urgentIds.has(g.child_id));
  const shownVisits = allVisits ? visits : visits.slice(0, FIRST_VISITS);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-ink-muted">{todayLabel}</p>
          <h1 className="font-display text-2xl font-extrabold text-ink">
            {firstName ? t('field.hello', { name: firstName }) : t('field.helloNoName')}
          </h1>
        </div>
        <Link to="/mothers/new" className={buttonClasses('primary', 'lg', 'w-full min-h-14 text-lg')}>
          <Plus className="size-6" />{t('field.register')}
        </Link>
      </header>

      {user?.is_batch_monitor && <TeamCallList />}

      {failed && (
        <Card className="flex items-start gap-3 p-4">
          <WifiOff className="mt-0.5 size-5 shrink-0 text-ink-muted" />
          <p className="text-sm text-ink">{t('field.loadFailed')}</p>
        </Card>
      )}

      {!view && !failed && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton variant="block" className="h-20" />
          <Skeleton variant="block" className="h-20" />
        </div>
      )}

      {view && (
        <>
          {view.urgent.length > 0 && (
            <Section icon={<AlertTriangle className="size-5 text-error-600" />} title={t('field.urgent.title')} count={view.urgent.length}>
              {view.urgent.map(u => <UrgentRow key={u.child_id} u={u} />)}
            </Section>
          )}

          <Section icon={<ClipboardList className="size-5 text-primary-ink" />} title={t('field.visits.title')} count={visits.length}>
            {visits.length ? shownVisits.map(g => <VisitRow key={`${g.mother_id}-${g.child_id ?? 'm'}`} g={g} />) : (
              <p className="flex items-center gap-2 rounded-xl bg-success-50 px-4 py-3 text-sm font-semibold text-success-600 dark:bg-success-500/15 dark:text-success-500">
                <Check className="size-5 shrink-0" />{nothingToday ? t('field.visits.allDone') : t('field.visits.none')}
              </p>
            )}
            {visits.length > FIRST_VISITS && (
              <button type="button" onClick={() => setAllVisits(v => !v)}
                className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border bg-surface text-sm font-semibold text-primary-ink">
                <ChevronDown className={cn('size-4 transition-transform', allVisits && 'rotate-180')} />
                {allVisits ? t('field.visits.fewer') : t('field.visits.more', { count: visits.length - FIRST_VISITS })}
              </button>
            )}
          </Section>

          {view.finish.length > 0 && (
            <Section icon={<HeartHandshake className="size-5 text-amber-600" />} title={t('field.finish.title')} count={view.finish.length}>
              {(allFinish ? view.finish : view.finish.slice(0, FIRST_VISITS)).map(f => (
                <Link
                  key={f.mother_id}
                  to={f.missing === 'protein'
                    ? formRunUrl('protein', f.mother_id, null, flowString('reg', f.then))
                    : `/mothers/${f.mother_id}/children/new?flow=reg`}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-amber-500/60 bg-surface p-3.5 hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base font-bold text-ink">{f.mother_name}</span>
                    <span className="block text-sm text-amber-700 dark:text-amber-400">{t(`field.finish.${f.missing}`)}</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-ink-muted" />
                </Link>
              ))}
              {view.finish.length > FIRST_VISITS && (
                <button type="button" onClick={() => setAllFinish(v => !v)}
                  className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border bg-surface text-sm font-semibold text-primary-ink">
                  <ChevronDown className={cn('size-4 transition-transform', allFinish && 'rotate-180')} />
                  {allFinish ? t('field.visits.fewer') : t('field.finish.more', { count: view.finish.length - FIRST_VISITS })}
                </button>
              )}
            </Section>
          )}

          {view.targets.length > 0 && (
            <Section icon={<UsersRound className="size-5 text-sage-600" />} title={t('field.adopt.title')}>
              {view.targets.map(x => <AdoptRow key={x.type} {...x} />)}
            </Section>
          )}

          {view.week.length > 0 && (
            <Section icon={<CalendarDays className="size-5 text-info-600" />} title={t('field.week.title')}>
              <Card className="divide-y divide-border">
                {view.week.map(day => (
                  <div key={day.date} className="px-4 py-3">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-muted">{shortDay(day.date)}</p>
                    <ul className="flex flex-col gap-1">
                      {day.items.map(g => {
                        const who = whoLine(g, t);
                        return (
                          <li key={`${g.mother_id}-${g.child_id ?? 'm'}`}>
                            <Link
                              to={g.child_id != null ? `/babies/${g.child_id}` : `/mothers/${g.mother_id}`}
                              className="flex items-baseline gap-2 py-0.5 text-sm hover:text-primary-ink"
                            >
                              <span className="font-semibold text-ink">{who.name}</span>
                              <span className="text-ink-muted">{formNames(g.forms.map(f => f.key), t)}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </Card>
            </Section>
          )}

          <div className="flex flex-col gap-2">
            {view.done_this_week > 0 && (
              <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                <Star className="size-5 shrink-0 fill-amber-400 text-amber-500" />
                {t('field.doneThisWeek', { count: view.done_this_week })}
              </p>
            )}
            {view.nil_days != null && view.nil_days > 7 && (
              <p className="rounded-xl bg-error-50 px-4 py-3 text-sm font-semibold text-error-700 dark:bg-error-500/15 dark:text-error-300">
                {t('field.quiet', { count: view.nil_days })}
              </p>
            )}
          </div>
        </>
      )}

      <nav className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        <Link to="/mothers" className="flex min-h-14 items-center gap-3 px-4 py-3 font-semibold text-ink hover:bg-surface-sunken">
          <UsersRound className="size-5 text-primary-ink" /><span className="flex-1">{t('field.allMothers')}</span><ChevronRight className="size-5 text-ink-muted" />
        </Link>
        <Link to="/dashboard?view=training" className="flex min-h-14 items-center gap-3 px-4 py-3 font-semibold text-ink hover:bg-surface-sunken">
          <GraduationCap className="size-5 text-primary-ink" /><span className="flex-1">{t('field.training')}</span><ChevronRight className="size-5 text-ink-muted" />
        </Link>
      </nav>
    </div>
  );
};

export default FieldHome;
