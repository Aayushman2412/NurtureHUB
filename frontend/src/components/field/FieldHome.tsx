import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlertTriangle, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList, Clock, GraduationCap, HeartHandshake,
  Plus, UsersRound, WifiOff,
} from 'lucide-react';
import { formRunUrl, getToday, type TaskGroup, type TodayView, type UrgentBaby } from '../../api/today';
import { flowString } from '../../lib/careFlow';
import { TONE_CLASSES } from '../../lib/babyStatus';
import { useAuth } from '../../context/AuthContext';
import { buttonClasses, Card, Skeleton, Tabs } from '../ui';
import { cn } from '../../utils/cn';
import { formNames, isTomorrow, localIso, shortDay, visitUrl, weekdayOf, whoLine } from './fieldText';
import VisitRow from './VisitRow';
import TeamCallList from './TeamCallList';
import { TierBadge } from './MyBabiesGrowth';
import MyProgress from './MyProgress';

/** Today's visits shown before "Show more" — the most late first. */
const FIRST_VISITS = 6;

type HomeTab = 'todo' | 'progress';

const Section: React.FC<{ icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }> = ({
  icon, title, count, children,
}) => (
  <section className="flex flex-col gap-2.5">
    <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
      {icon}
      <span>{title}</span>
      {count != null && count > 0 && (
        <span className="rounded-sm bg-surface-sunken px-2 py-0.5 text-sm font-semibold tabular-nums text-ink-muted">{count}</span>
      )}
    </h2>
    {children}
  </section>
);

/** The rows of one section: a single ruled panel, like a page of a register. */
const RowList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
    {children}
  </div>
);

const moreButton =
  'flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-md text-sm font-semibold text-primary-ink hover:bg-surface-sunken';

/** "Weight went down · visit by Sun", or "Very low weight · refer today". */
const urgentLine = (u: UrgentBaby, t: TFunction): string => {
  if (u.danger) return t(`field.danger.short.${u.danger.kind}`);
  const why = t(`field.reason.${u.reasons[0] ?? 'low_wfa'}`);
  if (!u.visit_by) return why;
  return `${why} · ${u.visit_by <= localIso() ? t('field.visitToday') : t('field.visitBy', { day: weekdayOf(u.visit_by) })}`;
};

/** A baby to see within 2 days: the reason in red or yellow; the row opens
 *  the baby, "Start" opens the visit. */
const UrgentRow: React.FC<{ u: UrgentBaby }> = ({ u }) => {
  const { t } = useTranslation('dashboard');
  const tone = TONE_CLASSES[u.status];
  const urgentText = u.danger ? 'text-error-600 dark:text-error-400' : tone.text;
  return (
    <div className={cn('flex items-center gap-3 border-l-[3px] px-3.5 py-3',
      u.status === 'red' || u.danger ? 'border-l-error-500' : 'border-l-amber-500')}>
      <Link to={`/babies/${u.child_id}`} className="flex min-w-0 flex-1 items-start gap-2.5">
        <AlertTriangle className={cn('mt-0.5 size-5 shrink-0', urgentText)} />
        <span className="min-w-0">
          <span className="block font-display text-base font-semibold leading-snug text-ink">
            {t('field.urgent.see', { name: u.child_name || t('field.baby'), count: u.see_within_days })}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn('text-sm font-semibold', urgentText)}>{urgentLine(u, t)}</span>
            {/* Ordered by the priority score; its tier in words (visit protocol, Nov 2026). */}
            <TierBadge tier={u.priority?.tier} />
          </span>
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
    <div className="flex items-center gap-3 rounded-lg bg-surface-sunken/70 px-3.5 py-3">
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
        <span className="shrink-0 text-right text-sm font-semibold text-primary-ink">{t('field.adopt.more', { count: more })}</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-success-600 dark:text-success-500">
          <Check className="size-4" />{t('field.adopt.done')}
        </span>
      )}
    </div>
  );
};

/** "Adopt 3 more mothers. You need 2 with a baby under 6 months and 1 with a
 *  baby 6 months or older. Ask your AWW for new deliveries this week." */
const adoptSentence = (targets: TodayView['targets'], t: TFunction): string | null => {
  const open = targets.filter(x => x.more > 0);
  const total = open.reduce((n, x) => n + x.more, 0);
  if (total === 0) return null;
  const parts = open.map(x => t(`field.adoptPrompt.${x.type}`, { count: x.more }));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}${t('field.adoptPrompt.and')}${parts[parts.length - 1]}` : parts[0];
  return [t('field.adoptPrompt.lead', { count: total }), t('field.adoptPrompt.need', { list }), t('field.adoptPrompt.tip')].join(' ');
};

/** One day of the next 7: "Sat 31 · Tomorrow — Komal: Growth check, Breastfeeding". */
const WeekDay: React.FC<{ date: string; items: TaskGroup[] }> = ({ date, items }) => {
  const { t } = useTranslation('dashboard');
  return (
    <div className="flex gap-3 px-4 py-3">
      <p className="w-16 shrink-0 text-xs font-semibold leading-snug text-ink-muted">
        {shortDay(date)}
        {isTomorrow(date) && <span className="block text-primary-ink">{t('field.next7.tomorrow')}</span>}
      </p>
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {items.map(g => {
          const who = whoLine(g, t);
          return (
            <li key={`${g.mother_id}-${g.child_id ?? 'm'}`}>
              <Link
                to={g.child_id != null ? `/babies/${g.child_id}` : `/mothers/${g.mother_id}`}
                className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-sm hover:text-primary-ink"
              >
                <span className="font-semibold text-ink">{who.name}</span>
                <span className="text-ink-muted">{formNames(g.forms.map(f => f.key), t)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** Visits due now, with "Show more". */
const VisitList: React.FC<{ visits: TaskGroup[] }> = ({ visits }) => {
  const { t } = useTranslation('dashboard');
  const [all, setAll] = useState(false);
  const shown = all ? visits : visits.slice(0, FIRST_VISITS);
  return (
    <>
      <RowList>{shown.map(g => <VisitRow key={`${g.mother_id}-${g.child_id ?? 'm'}`} g={g} />)}</RowList>
      {visits.length > FIRST_VISITS && (
        <button type="button" onClick={() => setAll(v => !v)} className={moreButton}>
          <ChevronDown className={cn('size-4 transition-transform', all && 'rotate-180')} />
          {all ? t('field.visits.fewer') : t('field.visits.more', { count: visits.length - FIRST_VISITS })}
        </button>
      )}
    </>
  );
};

/** What the To do panel lists now, without the babies already on top. */
const visitsNow = (view: TodayView): TaskGroup[] => {
  const onTop = new Set([...view.urgent.map(u => u.child_id), ...view.unfinished.map(u => u.child_id)]);
  return view.today.filter(g => g.child_id == null || !onTop.has(g.child_id));
};

/**
 * "To do" (launch review of 19 Oct 2026; Learner Redesign review of 30 Oct):
 * what to finish, the babies to see first, late visits (always "Late by N
 * days"), the visits due today, registrations to finish, the next 7 days and
 * whom to adopt — one tap starts each visit, its forms one after another.
 */
const TodoPanel: React.FC<{ view: TodayView }> = ({ view }) => {
  const { t } = useTranslation('dashboard');
  const [allFinish, setAllFinish] = useState(false);
  const nothingToday = !view.urgent.length && !view.today.length && !view.finish.length;
  const visits = visitsNow(view);
  const late = visits.filter(g => g.late_days > 0);
  const dueToday = visits.filter(g => g.late_days <= 0);
  const weekCount = view.week.reduce((n, d) => n + d.items.length, 0);
  const adopt = adoptSentence(view.targets, t);

  return (
    <div className="flex flex-col gap-6">
      {/* Visits begun and drafts saved come first (review of 30 Oct 2026:
          "whenever a draft is saved make sure it comes on the top"). */}
      {(view.unfinished.length > 0 || view.drafts.length > 0) && (
        <Section icon={<ClipboardList className="size-5 text-amber-600" />} title={t('field.unfinished.title')}
          count={view.unfinished.length + view.drafts.length}>
          <RowList>
          {view.unfinished.map(u => (
            <Link key={`u${u.child_id}`} to={visitUrl(u.mother_id, u.child_id, u.pending)}
              className="flex min-h-16 items-center gap-3 border-l-[3px] border-l-amber-500 px-3.5 py-3 hover:bg-surface-sunken">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-semibold text-ink">{u.child_name || t('field.baby')}</span>
                <span className="block text-sm text-success-600 dark:text-success-500">{t('field.unfinished.done', { forms: formNames(u.done, t) })}</span>
                <span className="block text-sm font-semibold text-amber-700 dark:text-amber-400">{t('field.unfinished.left', { forms: formNames(u.pending, t) })}</span>
              </span>
              <span className={buttonClasses('primary', 'sm', 'shrink-0 pointer-events-none')}>
                {t('field.unfinished.continue')}<ChevronRight className="size-4" />
              </span>
            </Link>
          ))}
          {view.drafts.map(d => (
            <Link key={`d${d.response_id}`} to={`${formRunUrl(d.form, d.mother_id, d.child_id)}?responseId=${d.response_id}`}
              className="flex min-h-14 items-center gap-3 border-l-[3px] border-l-amber-500 px-3.5 py-3 hover:bg-surface-sunken">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-semibold text-ink">{d.child_name || d.mother_name}</span>
                <span className="block text-sm text-amber-700 dark:text-amber-400">
                  {t('field.unfinished.draft', { form: t(`field.form.${d.form}`), date: shortDay(d.saved_on) })}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-ink-muted" />
            </Link>
          ))}
          </RowList>
        </Section>
      )}

      {view.urgent.length > 0 && (
        <Section icon={<AlertTriangle className="size-5 text-error-600" />} title={t('field.urgent.title')} count={view.urgent.length}>
          <RowList>{view.urgent.map(u => <UrgentRow key={u.child_id} u={u} />)}</RowList>
        </Section>
      )}

      {late.length > 0 && (
        <Section icon={<Clock className="size-5 text-error-600" />} title={t('field.lateVisits.title')} count={late.length}>
          <VisitList visits={late} />
        </Section>
      )}

      <Section icon={<ClipboardList className="size-5 text-primary-ink" />} title={t('field.dueTodayTitle')} count={dueToday.length}>
        {dueToday.length ? <VisitList visits={dueToday} /> : (
          <p className="flex items-center gap-2 rounded-lg border border-border border-l-[3px] border-l-success-500 bg-surface px-4 py-3 text-sm font-semibold text-ink">
            <Check className="size-5 shrink-0" />{nothingToday ? t('field.visits.allDone') : t('field.visits.none')}
          </p>
        )}
      </Section>

      {view.finish.length > 0 && (
        <Section icon={<HeartHandshake className="size-5 text-ink-muted" />} title={t('field.finish.title')} count={view.finish.length}>
          <RowList>
          {(allFinish ? view.finish : view.finish.slice(0, FIRST_VISITS)).map(f => (
            <Link
              key={f.mother_id}
              to={f.missing === 'protein'
                ? formRunUrl('protein', f.mother_id, null, flowString('reg', f.then))
                : `/mothers/${f.mother_id}/children/new?flow=${flowString('reg', f.then)}`}
              className="flex min-h-14 items-center gap-3 border-l-[3px] border-l-amber-500 px-3.5 py-3 hover:bg-surface-sunken"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-semibold text-ink">{f.mother_name}</span>
                <span className="block text-sm text-amber-700 dark:text-amber-400">{t(`field.finish.${f.missing}`)}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-ink-muted" />
            </Link>
          ))}
          </RowList>
          {view.finish.length > FIRST_VISITS && (
            <button type="button" onClick={() => setAllFinish(v => !v)} className={moreButton}>
              <ChevronDown className={cn('size-4 transition-transform', allFinish && 'rotate-180')} />
              {allFinish ? t('field.visits.fewer') : t('field.finish.more', { count: view.finish.length - FIRST_VISITS })}
            </button>
          )}
        </Section>
      )}

      {view.week.length > 0 && (
        <Section icon={<CalendarDays className="size-5 text-info-600" />} title={t('field.next7.title')} count={weekCount}>
          <Card className="divide-y divide-border">
            {view.week.map(day => <WeekDay key={day.date} date={day.date} items={day.items} />)}
          </Card>
        </Section>
      )}

      {view.targets.length > 0 && (
        <Section icon={<UsersRound className="size-5 text-success-600" />} title={t('field.adopt.title')}>
          {adopt && (
            <p className="rounded-lg border border-border border-l-[3px] border-l-primary bg-surface px-4 py-3 text-sm font-semibold text-ink">{adopt}</p>
          )}
          {view.targets.map(x => <AdoptRow key={x.type} {...x} />)}
        </Section>
      )}

      {view.nil_days != null && view.nil_days > 7 && (
        <p className="rounded-lg bg-error-50 px-4 py-3 text-sm font-semibold text-error-700 dark:bg-error-500/15 dark:text-error-300">
          {t('field.quiet', { count: view.nil_days })}
        </p>
      )}
    </div>
  );
};

/**
 * The health worker's home once adoptions start (launch review of 19 Oct
 * 2026): "as soon as they open the app, the app should tell them — do this,
 * do this". Two panels since the Learner Redesign review (30 Oct 2026):
 * "To do" — what to do now and in the next 7 days — and "My progress" —
 * her babies' growth, visits and forms against what is expected, adoptions
 * against her targets. The open panel rides in the URL (?tab=progress) so
 * Back returns to it.
 */
const FieldHome: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: HomeTab = params.get('tab') === 'progress' ? 'progress' : 'todo';
  const [view, setView] = useState<TodayView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getToday().then(v => { if (alive) setView(v); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const setTab = (next: HomeTab) => {
    const p = new URLSearchParams(params);
    if (next === 'todo') p.delete('tab'); else p.set('tab', next);
    setParams(p, { replace: true });
  };

  const firstName = (user?.full_name || '').trim().split(/\s+/)[0];
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const todoCount = view
    ? view.unfinished.length + view.drafts.length + view.urgent.length + view.finish.length + visitsNow(view).length
    : 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-ink-muted">{todayLabel}</p>
          <h1 className="font-display text-2xl font-semibold text-ink">
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
          <Tabs<HomeTab>
            value={tab}
            onChange={setTab}
            className="[&>button]:min-h-12 [&>button]:flex-1 [&>button]:justify-center [&>button]:text-base"
            items={[
              { value: 'todo', label: todoCount > 0 ? `${t('field.tabs.todo')} (${todoCount})` : t('field.tabs.todo') },
              { value: 'progress', label: t('field.tabs.progress') },
            ]}
          />
          {tab === 'todo' ? <TodoPanel view={view} /> : <MyProgress view={view} />}
        </>
      )}

      <nav className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
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
