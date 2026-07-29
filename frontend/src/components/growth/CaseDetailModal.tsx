import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Baby, User, Stethoscope, ClipboardList, BarChart3, LineChart } from 'lucide-react';
import { Modal, Spinner } from '../ui';
import { cn } from '../../utils/cn';
import {
  getGrowthCaseDetail,
  type GrowthCaseDetail,
  type GrowthSummaryRow,
  type ZTriplet,
} from '../../api/growth';
import { formatAge } from '../../lib/growthChart';
import { adoptionCategory, monthsDays } from '../../lib/growthDisplay';
import ResponseDetailCard from './ResponseDetailCard';
import { ChartCard, ActivityComparisonChart, OutcomeDivergingChart, ZTrendCard } from './CaseCharts';

/**
 * Full case drill-down opened by clicking a summary-table row.
 *
 * Top-to-bottom layout: the identity sections (learner / mother / child) side
 * by side, then the charts band — one combined EC/AC/IC histogram, one
 * diverging outcomes-z chart and the three z-trend plots, each expandable and
 * downloadable — then every submitted form grouped visit-by-visit. Each visit
 * row leads with the LAP status of the forms filed that day and the BV/AV/LV
 * z-triplets computed up to that visit.
 */
interface Props {
  row: GrowthSummaryRow | null;
  onClose: () => void;
}

const fmtZ = (z: number | null) => (z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}`);

const zTone = (z: number | null) =>
  z == null
    ? 'text-ink-faint'
    : z <= -3 || z >= 3
      ? 'text-coral-700'
      : z <= -2
        ? 'text-amber-600'
        : 'text-ink';

/** form_key → compact code shown on visit rows. */
const FORM_CODES: Record<string, string> = {
  growth_monitoring: 'CG',
  breastfeeding: 'BF',
  complementary_feeding: 'CF',
  mother_protein_intake: 'PI',
  antenatal: 'ANC',
};

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
    <span className="text-sm font-medium text-ink">{value}</span>
  </div>
);

/** One labeled identity section (learner / mother / child). */
const IdentitySection: React.FC<{
  icon: React.ReactNode;
  title: string;
  facts: { label: string; value: React.ReactNode }[];
}> = ({ icon, title, facts }) => (
  <div className="rounded-lg border border-border bg-surface-sunken/60 p-3">
    <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
      {icon}
      {title}
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {facts.map(f => (
        <Fact key={f.label} label={f.label} value={f.value} />
      ))}
    </div>
  </div>
);

/** LAP-status chip for one form filed on a visit (green/red tallies). */
const LapChip: React.FC<{ formKey: string; green: number; red: number }> = ({ formKey, green, red }) => {
  const code = FORM_CODES[formKey] ?? formKey.slice(0, 3).toUpperCase();
  const scored = green + red > 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
        !scored
          ? 'border-border text-ink-muted'
          : red === 0
            ? 'border-success-500/40 bg-success-50 text-success-600 dark:bg-success-500/10'
            : 'border-coral-500/40 bg-coral-50 text-coral-700 dark:bg-coral-500/10',
      )}
    >
      {code}
      {scored && (
        <>
          <span className="text-success-600">✓{green}</span>
          {red > 0 && <span className="text-coral-600">✕{red}</span>}
        </>
      )}
    </span>
  );
};

/** Compact "W −0.2/−0.1/+0.0" triplet-to-date chip for one metric. */
const ZTripletChip: React.FC<{ code: string; title: string; triplet: ZTriplet }> = ({ code, title, triplet }) => (
  <span
    className="inline-flex items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 text-[10px] tabular-nums"
    title={`${title} — BV ${fmtZ(triplet.bv)} · AV ${fmtZ(triplet.av)} · LV ${fmtZ(triplet.lv)}`}
  >
    <span className="font-bold text-ink-muted">{code}</span>
    <span className={zTone(triplet.bv)}>{fmtZ(triplet.bv)}</span>/
    <span className={zTone(triplet.av)}>{fmtZ(triplet.av)}</span>/
    <span className={zTone(triplet.lv)}>{fmtZ(triplet.lv)}</span>
  </span>
);

const CaseDetailModal: React.FC<Props> = ({ row, onClose }) => {
  const { t } = useTranslation('growth');
  const [detail, setDetail] = useState<GrowthCaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [openVisits, setOpenVisits] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setDetail(null);
    getGrowthCaseDetail(row.case_id)
      .then(d => {
        if (cancelled) return;
        setDetail(d);
        setOpenVisits(new Set()); // start collapsed — the row chips carry the summary
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row]);

  if (!row) return null;

  const toggle = (date: string) =>
    setOpenVisits(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });

  /** "Xm Yd"; antenatal ages render as the AN shorthand. */
  const fmtMonthsDays = (days: number | null) => {
    if (days == null) return '—';
    if (days < 0) return t('summary.antenatalShort');
    const v = monthsDays(days)!;
    return `${v.m}${t('summary.monthShort')} ${v.d}${t('summary.dayShort')}`;
  };

  const adoptCat = adoptionCategory(row.case_details.age_of_adoption_days);

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{t('caseDetail.title')}</span>
          <span className="font-mono text-sm text-ink-muted">{row.identity.child_uid}</span>
        </span>
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      )}
      {error && <p className="py-6 text-center text-sm text-error-600">{t('visitModal.loadError')}</p>}

      {!loading && !error && (
        <div className="space-y-4">
          {/* ── identity sections side by side ─────────────────────────────── */}
          <div className="grid gap-2 md:grid-cols-3">
            <IdentitySection
              icon={<Stethoscope className="size-3.5" />}
              title={t('caseDetail.learnerDetails')}
              facts={[
                { label: t('summary.learner'), value: detail?.learner?.name ?? row.identity.learner_name ?? t('admin.orphanLearner') },
                { label: t('summary.role'), value: detail?.learner?.role ?? row.identity.role_group ?? '—' },
                { label: t('filters.department'), value: detail?.learner?.department ?? row.meta.department ?? '—' },
              ]}
            />
            <IdentitySection
              icon={<User className="size-3.5" />}
              title={t('caseDetail.motherDetails')}
              facts={[
                { label: t('summary.mother'), value: detail?.mother?.name ?? row.identity.mother_name },
                { label: 'UID', value: <span className="font-mono text-xs">{detail?.mother?.uid ?? '—'}</span> },
                { label: t('caseDetail.village'), value: detail?.mother?.village ?? '—' },
                { label: t('caseDetail.mobile'), value: detail?.mother?.mobile ?? '—' },
                { label: t('caseDetail.motherAge'), value: detail?.mother?.age ?? '—' },
              ]}
            />
            <IdentitySection
              icon={<Baby className="size-3.5" />}
              title={t('caseDetail.childDetails')}
              facts={[
                { label: t('caseDetail.childName'), value: detail?.child.name ?? '—' },
                { label: 'UID', value: <span className="font-mono text-xs">{row.identity.child_uid}</span> },
                { label: t('caseDetail.gender'), value: detail?.child.gender ?? row.meta.sex ?? '—' },
                { label: t('caseDetail.born'), value: detail?.child.dob ?? '—' },
                {
                  label: t('summary.type'),
                  value: (
                    <span title={row.case_details.adoption_type ?? undefined}>
                      {adoptCat ? t(`summary.cat.${adoptCat}`) : (row.case_details.adoption_type ?? '—')}
                    </span>
                  ),
                },
                { label: t('summary.adoptAgeFull'), value: fmtMonthsDays(row.case_details.age_of_adoption_days) },
                { label: t('summary.durationFull'), value: fmtMonthsDays(row.case_details.adoption_duration_days) },
              ]}
            />
          </div>

          {/* ── charts band ────────────────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
              <BarChart3 className="size-3.5" />
              {t('caseDetail.metrics')}
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              <ChartCard
                title={t('caseDetail.activityChart')}
                render={ref => (
                  <ActivityComparisonChart
                    svgRef={ref}
                    legend={{ ec: 'EC', ac: 'AC', ic: 'IC' }}
                    groups={[
                      { label: t('summary.groups.total'), block: row.activities.total },
                      { label: 'CG', block: row.activities.cg },
                      { label: 'BF', block: row.activities.bf },
                      { label: 'CF', block: row.activities.cf },
                    ]}
                  />
                )}
              />
              <ChartCard
                title={t('caseDetail.outcomesChart')}
                render={ref => (
                  <OutcomeDivergingChart
                    svgRef={ref}
                    outcomes={row.outcomes}
                    legend={{ wfaz: t('summary.wfaz'), hfaz: t('summary.hfaz'), wfhz: t('summary.wfhz') }}
                    visitLabels={{ bv: 'BV', av: 'AV', lv: 'LV' }}
                  />
                )}
              />
            </div>

            <div className="mb-2 mt-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
              <LineChart className="size-3.5" />
              {t('caseDetail.zTrends')}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <ZTrendCard label={t('summary.wfaz')} visits={detail?.visits ?? []} pick={v => v.z.wfaz} />
              <ZTrendCard label={t('summary.hfaz')} visits={detail?.visits ?? []} pick={v => v.z.hfaz} />
              <ZTrendCard label={t('summary.wfhz')} visits={detail?.visits ?? []} pick={v => v.z.wfhz} />
            </div>
          </div>

          {/* ── visits ─────────────────────────────────────────────────────── */}
          {detail && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Baby className="size-4 text-ink-muted" />
                  {t('caseDetail.visits')} ({detail.visits.length})
                </div>
                {detail.visits.length > 0 && (
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="text-primary-ink hover:underline"
                      onClick={() => setOpenVisits(new Set(detail.visits.map(v => v.date)))}
                    >
                      {t('caseDetail.expandAll')}
                    </button>
                    <button
                      type="button"
                      className="text-ink-muted hover:underline"
                      onClick={() => setOpenVisits(new Set())}
                    >
                      {t('caseDetail.collapseAll')}
                    </button>
                  </div>
                )}
              </div>

              {detail.visits.length === 0 && (
                <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">
                  {t('caseDetail.noVisits')}
                </p>
              )}

              <div className="space-y-2">
                {detail.visits.map(v => {
                  const open = openVisits.has(v.date);
                  return (
                    <div key={v.date} className="overflow-hidden rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => toggle(v.date)}
                        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 bg-surface-sunken px-3 py-2 text-left transition-colors hover:bg-surface-sunken/70"
                      >
                        {open ? (
                          <ChevronDown className="size-4 shrink-0 text-ink-muted" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-ink-muted" />
                        )}
                        <span className="font-semibold text-ink">{v.date}</span>
                        {v.age_days != null && (
                          <span className="text-xs text-ink-muted">
                            {t('tooltip.age')} {formatAge(v.age_days)}
                          </span>
                        )}
                        {/* LAP status of every form filed this visit */}
                        <span className="flex flex-wrap items-center gap-1">
                          {v.responses.map(r => (
                            <LapChip
                              key={r.id}
                              formKey={r.form_key}
                              green={r.summary_json?.green ?? 0}
                              red={r.summary_json?.red ?? 0}
                            />
                          ))}
                        </span>
                        {/* z triplets to date */}
                        <span className="ml-auto flex flex-wrap items-center gap-1">
                          <ZTripletChip code="W" title={t('summary.wfaz')} triplet={v.z_to_date.wfaz} />
                          <ZTripletChip code="H" title={t('summary.hfaz')} triplet={v.z_to_date.hfaz} />
                          <ZTripletChip code="WH" title={t('summary.wfhz')} triplet={v.z_to_date.wfhz} />
                        </span>
                      </button>
                      {open && (
                        <div className="px-3 py-2">
                          {v.responses.map(r => (
                            <ResponseDetailCard key={r.id} detail={r} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* mother-level forms */}
              {detail.mother_forms.length > 0 && (
                <>
                  <div className="mb-2 mt-5 flex items-center gap-1.5 text-sm font-bold text-ink">
                    <User className="size-4 text-ink-muted" />
                    {t('caseDetail.motherForms')} ({detail.mother_forms.length})
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    {detail.mother_forms.map(r => (
                      <div key={r.id}>
                        <div className="flex items-center gap-1.5 pt-2 text-xs text-ink-faint">
                          <ClipboardList className="size-3.5" />
                          {r.assessment_date}
                        </div>
                        <ResponseDetailCard detail={r} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default CaseDetailModal;
