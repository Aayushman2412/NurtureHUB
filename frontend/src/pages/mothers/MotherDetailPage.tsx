import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Baby, ChevronDown, ChevronRight, CircleCheck, CloudUpload, FileText, History, Plus } from 'lucide-react';
import { buttonClasses, Card, PageHeader, PageLoader } from '../../components/ui';
import LearnerMotherCard from '../../components/mothers/LearnerMotherCard';
import VisitRow from '../../components/field/VisitRow';
import { useToast } from '../../context/ToastContext';
import { getMother, type Mother } from '../../api/mothers';
import { listChildren, type ChildListItem } from '../../api/children';
import { formRunUrl, getToday, type CaseRow, type TodayView } from '../../api/today';
import { flowString } from '../../lib/careFlow';
import { TONE_CLASSES } from '../../lib/babyStatus';
import { usePendingSync } from '../../offline/usePendingSync';
import { SYNC_DONE_EVENT } from '../../offline/sync';
import { cn } from '../../utils/cn';

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
    <span className="text-ink-muted">{label}</span>
    <span className="text-right font-medium text-ink">{value ?? '—'}</span>
  </div>
);

/**
 * One mother, for the health worker (launch review of 19 Oct 2026): what to
 * do now first, then her babies (each opens the baby's page), then her own
 * forms. Her registration details are one tap down ("know more"), not in the
 * way.
 */
const MotherDetailPage: React.FC = () => {
  const { id } = useParams();
  const motherId = Number(id);
  const [params] = useSearchParams();
  const { t } = useTranslation('mother');
  const { t: tf } = useTranslation('dashboard');
  const { showToast } = useToast();
  const [mother, setMother] = useState<Mother | null>(null);
  const [children, setChildren] = useState<ChildListItem[]>([]);
  const [today, setToday] = useState<TodayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  // Children registered offline under THIS mother show as "waiting to sync"
  // cards — hiding them here invited duplicate registrations.
  const { items: pendingItems } = usePendingSync();
  const pendingChildren = pendingItems.filter(
    i => i.kind === 'child' && Number(i.route.motherId) === motherId,
  );

  useEffect(() => {
    const load = () =>
      Promise.all([getMother(motherId), listChildren(motherId)])
        .then(([m, kids]) => { setMother(m); setChildren(kids); })
        .catch(() => showToast(t('detail.loadFailed'), 'error'))
        .finally(() => setLoading(false));
    void load();
    getToday().then(setToday).catch(() => { /* what to do now is optional offline */ });
    // A queued child that just synced should appear in the real list.
    const onSync = () => void load();
    window.addEventListener(SYNC_DONE_EVENT, onSync);
    return () => window.removeEventListener(SYNC_DONE_EVENT, onSync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motherId]);

  if (loading) return <PageLoader label={t('detail.loading')} className="min-h-60" />;
  if (!mother) return null;

  const row: CaseRow | undefined = today?.cases.find(c => c.mother_id === motherId);
  const now = today?.today.filter(g => g.mother_id === motherId) ?? [];
  const finish = today?.finish.find(f => f.mother_id === motherId);
  const statusOf = (childId: number) => row?.children.find(k => k.id === childId)?.status ?? 'none';
  const pregnant = children.length === 0 && (row?.type ?? 'anc') === 'anc';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader
        title={mother.mother_name}
        description={[row?.type && row.type !== 'unknown' ? tf(`field.type.${row.type}`) : null, mother.village, mother.mother_uid]
          .filter(Boolean).join(' · ')}
        backTo="/mothers"
      />

      {params.get('done') === '1' && (
        <p className="flex items-center gap-2 rounded-xl bg-success-50 px-4 py-3 font-semibold text-success-600 dark:bg-success-500/15 dark:text-success-500">
          <CircleCheck className="size-5 shrink-0" />{tf('field.baby.visitDone')}
        </p>
      )}

      {row && (
        <p className={cn('flex items-center gap-2.5 rounded-xl px-4 py-3 font-semibold', TONE_CLASSES[row.status].soft, TONE_CLASSES[row.status].text)}>
          <span className={cn('size-3.5 shrink-0 rounded-full', TONE_CLASSES[row.status].dot)} aria-hidden />
          {tf(`field.rowStatus.${row.status}`)} — {tf(`field.reason.${row.reason}`, { defaultValue: tf('field.reason.low') })}
        </p>
      )}

      {/* What to do now */}
      {(finish || now.length > 0) && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-display text-lg font-bold text-ink">{tf('field.mother.doNow')}</h2>
          {finish && (
            <Link
              to={finish.missing === 'protein'
                ? formRunUrl('protein', motherId, null, flowString('reg', finish.then))
                : `/mothers/${motherId}/children/new?flow=reg`}
              className="flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-amber-500/60 bg-surface p-3.5 hover:bg-surface-sunken"
            >
              <span className="min-w-0 flex-1 font-semibold text-amber-700 dark:text-amber-400">{tf(`field.finish.${finish.missing}`)}</span>
              <ChevronRight className="size-5 shrink-0 text-ink-muted" />
            </Link>
          )}
          {now.map(g => <VisitRow key={`${g.child_id ?? 'm'}`} g={g} />)}
        </section>
      )}

      {/* Babies */}
      <section className="flex flex-col gap-2.5">
        <h2 className="font-display text-lg font-bold text-ink">{tf('field.mother.babies')}</h2>
        {pendingChildren.map(item => (
          <div key={item.id} className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3">
            <CloudUpload className="size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{item.label}</div>
              <div className="text-xs text-ink-muted">{t('pendingSyncHint', { ns: 'offline' })}</div>
            </div>
          </div>
        ))}
        {children.map(c => {
          const st = statusOf(c.id);
          return (
            <Link key={c.id} to={`/babies/${c.id}`} className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-(--shadow-card) hover:border-border-strong">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-coral-50 text-primary-ink dark:bg-coral-500/10">
                <Baby className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-bold text-ink">{c.child_name || tf('field.baby')}</span>
                <span className={cn('flex items-center gap-1.5 text-sm font-semibold', TONE_CLASSES[st].text)}>
                  <span className={cn('size-2.5 rounded-full', TONE_CLASSES[st].dot)} aria-hidden />{tf(`field.short.${st}`)}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-ink-faint" />
            </Link>
          );
        })}
        <Link to={`/mothers/${motherId}/children/new`} className={buttonClasses('outline', 'md', 'w-full min-h-12')}>
          <Plus className="size-5" />{t('detail.addChild')}
        </Link>
      </section>

      {/* Her own forms */}
      <section className="flex flex-col gap-2.5">
        <h2 className="font-display text-lg font-bold text-ink">{tf('field.mother.forms')}</h2>
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {(pregnant ? (['anc', 'protein'] as const) : (['protein'] as const)).map(f => (
            <Link key={f} to={formRunUrl(f, motherId, null)} className="flex min-h-14 items-center gap-3 px-4 py-3 font-semibold text-ink hover:bg-surface-sunken">
              <FileText className="size-5 text-primary-ink" />
              <span className="flex-1">{tf('field.baby.fillOnly', { form: tf(`field.form.${f}`) })}</span>
              <ChevronRight className="size-5 text-ink-muted" />
            </Link>
          ))}
          <Link to={`/mothers/${motherId}/assessments/mother_protein_intake`} className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm font-semibold text-ink-muted hover:bg-surface-sunken">
            <History className="size-5" />
            <span className="flex-1">{tf('field.mother.pastProtein')}</span>
            <ChevronRight className="size-5" />
          </Link>
          {pregnant && (
            <Link to={`/mothers/${motherId}/assessments/antenatal`} className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm font-semibold text-ink-muted hover:bg-surface-sunken">
              <History className="size-5" />
              <span className="flex-1">{tf('field.mother.pastAnc')}</span>
              <ChevronRight className="size-5" />
            </Link>
          )}
        </div>
      </section>

      {/* Know more: her registration details */}
      <button
        type="button"
        onClick={() => setMore(v => !v)}
        aria-expanded={more}
        className="flex min-h-12 items-center justify-center gap-1.5 text-sm font-semibold text-primary-ink"
      >
        <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} />
        {more ? tf('field.mother.lessDetails') : tf('field.mother.moreDetails')}
      </button>
      {more && (
        <>
          <LearnerMotherCard mother={mother} showProteinAction={false} />
          <Card className="p-5">
            <h3 className="mb-3 font-display text-lg font-bold text-ink">{t('detail.clinical')}</h3>
            <Row label={t('detail.rowAge')} value={mother.mother_age ? t('detail.ageValue', { n: mother.mother_age }) : null} />
            <Row label={t('detail.rowWeightHeight')} value={mother.weight && mother.height ? t('detail.weightHeightValue', { weight: mother.weight, height: mother.height }) : null} />
            <Row label={t('detail.rowLmp')} value={mother.lmp} />
            <Row label={t('detail.rowEdd')} value={`${mother.edd_lmp || '—'} / ${mother.edd_records || '—'}`} />
            <Row label={t('detail.rowGestational')} value={mother.gestational_weeks != null ? t('detail.gestationalValue', { weeks: mother.gestational_weeks, days: mother.gestational_days }) : null} />
            <Row label={t('detail.rowMobile')} value={mother.mobile} />
          </Card>
        </>
      )}
    </div>
  );
};

export default MotherDetailPage;
