import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, CircleCheck, FileText, Info, Pencil } from 'lucide-react';
import {
  getGrowthStandards, getMyGrowthCaseDetail, type GrowthStandards, type MyGrowthCaseDetail,
} from '../../api/growth';
import { formRunUrl, getToday, type BabyStatus, type FormCode, type Status, type TaskGroup, type Tone, type TodayView } from '../../api/today';
import { babyVisitForms, nextInFlow, parseFlow } from '../../lib/careFlow';
import { TONE_CLASSES } from '../../lib/babyStatus';
import { Alert, Button, buttonClasses, Card, Modal, PageLoader } from '../../components/ui';
import BabyCharts from '../../components/field/BabyCharts';
import { formNames, shortDay, visitUrl } from '../../components/field/fieldText';
import { cn } from '../../utils/cn';

const daysSince = (ymd: string | null): number | null => {
  if (!ymd) return null;
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const born = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now.getTime() - born.getTime()) / 86_400_000);
};

/** "12 days", "6 weeks", "4 months" */
const ageText = (days: number | null, t: TFunction): string | null => {
  if (days == null || days < 0) return null;
  if (days < 14) return t('field.age.days', { count: days });
  if (days < 98) return t('field.age.weeks', { count: Math.round(days / 7) });
  return t('field.age.months', { count: Math.floor(days / 30.4375) });
};

/** The status in words and colour: "Growing well", "Watch closely", "Needs care now". */
const StatusCard: React.FC<{ status: BabyStatus }> = ({ status }) => {
  const { t } = useTranslation('dashboard');
  const tone = TONE_CLASSES[status.status];
  const reasons = status.reasons.filter(r => r !== 'no_growth_check');
  return (
    <div className={cn('rounded-2xl p-4 ring-2', tone.soft, tone.ring)}>
      <p className={cn('flex items-center gap-2.5 font-display text-xl font-extrabold', tone.text)}>
        <span className={cn('size-4 shrink-0 rounded-full', tone.dot)} aria-hidden />
        {t(`field.status.${status.status}`)}
      </p>
      {reasons.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm font-semibold text-ink">
          {reasons.map(r => <li key={r}>• {t(`field.reason.${r}`)}</li>)}
        </ul>
      )}
      {status.see_within_days != null && (
        <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm font-bold text-ink">
          {t('field.baby.seeWithin', { count: status.see_within_days })}
        </p>
      )}
    </div>
  );
};

/** One number with its colour and word: "P23 — Good". */
const Tile: React.FC<{ label: string; value: string; tone: Tone | null; word: string; wordy?: boolean }> = ({ label, value, tone, word, wordy }) => {
  const c = TONE_CLASSES[(tone ?? 'none') as Status];
  return (
    <div className={cn('flex flex-col items-center gap-0.5 rounded-xl px-2 py-3 text-center', c.soft)}>
      <span className="text-xs font-semibold leading-tight text-ink-muted">{label}</span>
      <span className={cn('font-display font-extrabold tabular-nums', wordy ? 'py-1 text-base leading-tight' : 'text-2xl', c.text)}>{value}</span>
      <span className={cn('flex items-center gap-1 text-xs font-bold', c.text)}>
        <span className={cn('size-2 rounded-full', c.dot)} aria-hidden />{word}
      </span>
    </div>
  );
};

const Tiles: React.FC<{ status: BabyStatus }> = ({ status }) => {
  const { t } = useTranslation('dashboard');
  const l = status.latest;
  if (!l) return null;
  const word = (tone: Tone | null) => (tone ? t(`field.tone.${tone}`) : '—');
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Tile label={t('field.baby.wfa')} value={l.wfa.pct != null ? `P${l.wfa.pct}` : '—'} tone={l.wfa.tone} word={word(l.wfa.tone)} />
        <Tile label={t('field.baby.lfa')} value={l.lfa.pct != null ? `P${l.lfa.pct}` : '—'} tone={l.lfa.tone} word={word(l.lfa.tone)} />
        <Tile label={t('field.baby.wfl')} value={l.wfl.grade ? t(`field.wfl.${l.wfl.grade}`) : '—'} tone={l.wfl.tone} word={word(l.wfl.tone)} wordy />
      </div>
      <p className="text-center text-xs text-ink-muted">
        {t('field.baby.lastCheck', {
          date: shortDay(l.date),
          weight: l.weight != null ? `${l.weight} kg` : '—',
          length: l.length != null ? `${l.length} cm` : '—',
        })}
      </p>
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" />{t('field.baby.whatIsP', { pct: l.wfa.pct ?? 50 })}
      </p>
    </div>
  );
};

/** This baby's visit from Today: due now, or the next day in the week. */
const nextVisit = (today: TodayView | null, childId: number): { group: TaskGroup; now: boolean } | null => {
  if (!today) return null;
  const now = today.today.find(g => g.child_id === childId);
  if (now) return { group: now, now: true };
  for (const day of today.week) {
    const g = day.items.find(x => x.child_id === childId);
    if (g) return { group: g, now: false };
  }
  return null;
};

/**
 * One baby, for the health worker (launch review of 19 Oct 2026). Two or
 * three numbers only — weight-for-age and length-for-age percentiles and the
 * weight-for-length grade — each with its colour and word; the charts with
 * one baby on them; the next visit; and "See all details" for the full
 * record. A just-saved growth check opens the charts at once.
 */
const BabyPage: React.FC = () => {
  const { childId: param } = useParams();
  const childId = Number(param);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');
  const [detail, setDetail] = useState<MyGrowthCaseDetail | null>(null);
  const [standards, setStandards] = useState<GrowthStandards | null>(null);
  const [today, setToday] = useState<TodayView | null>(null);
  const [failed, setFailed] = useState(false);

  const saved = params.get('saved') === 'gm';
  const done = params.get('done') === '1';
  const flow = parseFlow(params.get('flow'));

  useEffect(() => {
    let alive = true;
    Promise.all([getMyGrowthCaseDetail(childId), getGrowthStandards()])
      .then(([d, s]) => { if (alive) { setDetail(d); setStandards(s); } })
      .catch(() => { if (alive) setFailed(true); });
    getToday().then(v => { if (alive) setToday(v); }).catch(() => { /* the next visit is optional */ });
    return () => { alive = false; };
  }, [childId]);

  const ageDays = useMemo(() => daysSince(detail?.child.dob ?? null), [detail]);
  const visit = nextVisit(today, childId);

  if (failed) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Alert variant="error" title={t('field.baby.loadFailed')}>{t('field.loadFailed')}</Alert>
        <Link to="/dashboard" className={buttonClasses('outline')}>{t('field.backHome')}</Link>
      </div>
    );
  }
  if (!detail || !standards) return <PageLoader label={t('field.baby.loading')} className="min-h-60" />;

  const motherId = detail.mother?.id ?? detail.who_case?.mother.id ?? 0;
  const name = detail.child.name || t('field.baby');
  const status: BabyStatus = detail.status ?? { status: 'none', reasons: ['no_growth_check'], see_within_days: null, latest: null, previous: null };
  const forms: FormCode[] = babyVisitForms(ageDays);
  const startVisit = (list: FormCode[]) => visitUrl(motherId, childId, list);
  const closeSaved = () => {
    const next = new URLSearchParams(params);
    next.delete('saved');
    next.delete('flow');
    setParams(next, { replace: true });
  };
  const nextStep = flow?.rest[0];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/dashboard'))}
          className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" />{t('field.back')}
        </button>
        <h1 className="font-display text-2xl font-extrabold text-ink">{name}</h1>
        <p className="text-sm text-ink-muted">
          {[
            detail.child.gender === 'Male' ? t('field.boy') : detail.child.gender === 'Female' ? t('field.girl') : null,
            ageText(ageDays, t),
            detail.mother?.name ? t('field.motherIs', { mother: detail.mother.name }) : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      {done && (
        <p className="flex items-center gap-2 rounded-xl bg-success-50 px-4 py-3 font-semibold text-success-600 dark:bg-success-500/15 dark:text-success-500">
          <CircleCheck className="size-5 shrink-0" />{t('field.baby.visitDone')}
        </p>
      )}

      <StatusCard status={status} />
      <Tiles status={status} />

      {/* The next visit, or start one now */}
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
          <CalendarDays className="size-5 text-primary-ink" />{t('field.baby.nextVisit')}
        </h2>
        {visit ? (
          <p className="text-sm text-ink">
            <b className={visit.now ? (visit.group.late_days > 0 ? 'text-error-600 dark:text-error-400' : 'text-amber-700 dark:text-amber-400') : ''}>
              {visit.now ? (visit.group.late_days > 0 ? t('field.late') : t('field.dueToday')) : shortDay(visit.group.due_on)}
            </b>
            {' — '}{formNames(visit.group.forms.map(f => f.key), t)}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">{t('field.baby.noneThisWeek')}</p>
        )}
        <Link to={startVisit(visit?.now ? visit.group.forms.map(f => f.key) : forms)} className={buttonClasses('primary', 'lg', 'w-full')}>
          {t('field.baby.startVisit')}<ChevronRight className="size-5" />
        </Link>
        <p className="text-center text-xs text-ink-muted">{t('field.baby.visitIs', { forms: formNames(visit?.now ? visit.group.forms.map(f => f.key) : forms, t) })}</p>
      </Card>

      {detail.who_case && <BabyCharts who={detail.who_case} visits={detail.visits} standards={standards} />}

      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {forms.map(f => (
          <Link key={f} to={formRunUrl(f, motherId, childId)} className="flex min-h-14 items-center gap-3 px-4 py-3 font-semibold text-ink hover:bg-surface-sunken">
            <FileText className="size-5 text-primary-ink" />
            <span className="flex-1">{t('field.baby.fillOnly', { form: t(`field.form.${f}`) })}</span>
            <ChevronRight className="size-5 text-ink-muted" />
          </Link>
        ))}
        <Link to={`/growth/cases/${childId}?from=baby-${childId}`} className="flex min-h-14 items-center gap-3 px-4 py-3 font-semibold text-ink hover:bg-surface-sunken">
          <Info className="size-5 text-primary-ink" />
          <span className="flex-1">{t('field.baby.allDetails')}</span>
          <ChevronRight className="size-5 text-ink-muted" />
        </Link>
        {motherId > 0 && (
          <Link to={`/mothers/${motherId}/children/${childId}`} className="flex min-h-14 items-center gap-3 px-4 py-3 font-semibold text-ink hover:bg-surface-sunken">
            <Pencil className="size-5 text-primary-ink" />
            <span className="flex-1">{t('field.baby.edit')}</span>
            <ChevronRight className="size-5 text-ink-muted" />
          </Link>
        )}
        {motherId > 0 && (
          <Link to={`/mothers/${motherId}`} className="flex min-h-14 items-center gap-3 px-4 py-3 font-semibold text-ink hover:bg-surface-sunken">
            <ArrowRight className="size-5 text-primary-ink" />
            <span className="flex-1">{t('field.baby.openMother', { mother: detail.mother?.name ?? '' })}</span>
            <ChevronRight className="size-5 text-ink-muted" />
          </Link>
        )}
      </div>

      {/* A growth check was just saved: the chart opens at once. */}
      <Modal
        open={saved}
        onClose={closeSaved}
        size="lg"
        title={<span className="flex items-center gap-2"><Check className="size-5 text-success-600" />{t('field.baby.savedTitle')}</span>}
        footer={nextStep ? (
          <Button size="lg" fullWidth onClick={() => navigate(nextInFlow(flow, motherId, childId), { replace: true })} iconRight={<ArrowRight className="size-5" />}>
            {t(`flow.next.${nextStep}`, { ns: 'assessments' })}
          </Button>
        ) : (
          <Button size="lg" fullWidth onClick={closeSaved}>{t('field.baby.ok')}</Button>
        )}
      >
        <div className="flex flex-col gap-4">
          <StatusCard status={status} />
          <Tiles status={status} />
          {detail.who_case && <BabyCharts who={detail.who_case} visits={detail.visits} standards={standards} />}
        </div>
      </Modal>
    </div>
  );
};

export default BabyPage;
