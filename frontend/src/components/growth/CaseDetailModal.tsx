import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Baby, User, Stethoscope, ClipboardList, BarChart3, LineChart } from 'lucide-react';
import { Modal, Spinner } from '../ui';
import { cn } from '../../utils/cn';
import {
  getGrowthCaseDetail,
  type GrowthCaseDetail,
  type GrowthSummaryRow,
  type GrowthVisitDetail,
  type ActivityBlock,
  type ZTriplet,
} from '../../api/growth';
import { formatAge } from '../../lib/growthChart';
import ResponseDetailCard from './ResponseDetailCard';

/**
 * Full case drill-down opened by clicking a summary-table row.
 *
 * Three-column layout: LEFT a sidebar of activity + outcome bar charts, CENTER
 * the identity sections (learner / mother / child) and every submitted form
 * grouped visit-by-visit, RIGHT the z-score trend plots (WFA / HFA / WFH).
 * Each visit row leads with the LAP status of the forms filed that day and the
 * BV/AV/LV z-triplets computed up to that visit — the raw measurements stay
 * inside the expanded Check Growth answers.
 */
interface Props {
  row: GrowthSummaryRow | null;
  onClose: () => void;
}

const fmtZ = (z: number | null) => (z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}`);
const fmtMonths = (days: number | null) =>
  days == null ? '—' : days < 0 ? 'AN' : `${Math.round(days / 30.44)}m`;

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
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {facts.map(f => (
        <Fact key={f.label} label={f.label} value={f.value} />
      ))}
    </div>
  </div>
);

/** EC / AC / IC mini bar chart for one activity group. */
const ActivityBars: React.FC<{ label: string; block: ActivityBlock }> = ({ label, block }) => {
  const { t } = useTranslation('growth');
  const bars = [
    { code: 'EC', value: block.expected, cls: 'bg-cream-300 dark:bg-cream-700' },
    { code: 'AC', value: block.actual, cls: 'bg-sage-500' },
    { code: 'IC', value: block.incomplete, cls: 'bg-coral-400' },
  ];
  const max = Math.max(1, ...bars.map(b => b.value ?? 0));
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="flex items-end gap-2">
        {bars.map(b => (
          <div key={b.code} className="flex flex-1 flex-col items-center gap-0.5" title={`${b.code}: ${b.value ?? '—'}`}>
            <span className="text-[10px] tabular-nums text-ink-muted">{b.value ?? '—'}</span>
            {/* px height — % would resolve against the auto-height column and collapse */}
            <div
              className={cn('w-full rounded-t', b.cls, b.value == null && 'opacity-25')}
              style={{ height: `${Math.max(4, Math.round(56 * ((b.value ?? 0) / max)))}px` }}
            />
            <span className="text-[9px] font-semibold text-ink-faint">{b.code}</span>
          </div>
        ))}
      </div>
      {block.actual_pct != null && (
        <div className="mt-1 text-right text-[10px] font-semibold text-ink-muted">
          {t('caseDetail.completion', { pct: block.actual_pct })}
        </div>
      )}
    </div>
  );
};

/** Signed BV/AV/LV bars around a zero line for one z metric. */
const OutcomeBars: React.FC<{ label: string; triplet: ZTriplet }> = ({ label, triplet }) => {
  const entries: { code: string; z: number | null }[] = [
    { code: 'BV', z: triplet.bv },
    { code: 'AV', z: triplet.av },
    { code: 'LV', z: triplet.lv },
  ];
  const scale = 3; // ±3 SD fills the half-height
  return (
    <div className="flex-1">
      <div className="mb-0.5 text-center text-[10px] font-bold text-ink-muted">{label}</div>
      <div className="flex h-20 items-stretch gap-1">
        {entries.map(e => {
          const clamped = e.z == null ? 0 : Math.max(-scale, Math.min(scale, e.z));
          const half = Math.abs(clamped) / scale / 2; // fraction of full height
          const positive = (e.z ?? 0) >= 0;
          return (
            <div key={e.code} className="relative flex-1" title={`${e.code}: ${fmtZ(e.z)}`}>
              <div className="absolute inset-x-0 top-1/2 border-t border-border" />
              {e.z != null && (
                <div
                  className={cn(
                    'absolute inset-x-[15%] rounded-sm',
                    positive ? 'bottom-1/2 bg-sage-500' : 'top-1/2 bg-coral-500',
                  )}
                  style={{ height: `${Math.max(3, half * 100)}%` }}
                />
              )}
              <span
                className={cn(
                  'absolute inset-x-0 text-center text-[9px] tabular-nums',
                  positive ? 'top-0' : 'bottom-3',
                  zTone(e.z),
                )}
              >
                {fmtZ(e.z)}
              </span>
              <span className="absolute inset-x-0 bottom-0 text-center text-[9px] font-semibold text-ink-faint">
                {e.code}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** z trend across visits for one metric — dots + line with 0 / ±2 / ±3 bands. */
const ZTrendPlot: React.FC<{
  label: string;
  visits: GrowthVisitDetail[];
  pick: (v: GrowthVisitDetail) => number | null;
}> = ({ label, visits, pick }) => {
  const { t } = useTranslation('growth');
  const pts = visits
    .map((v, i) => ({ x: v.age_days ?? i, z: pick(v) }))
    .filter((p): p is { x: number; z: number } => p.z != null);

  const W = 232;
  const H = 120;
  const PAD = { l: 20, r: 8, t: 8, b: 14 };
  const zMin = -4;
  const zMax = 4;
  const xs = pts.map(p => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const sx = (x: number) =>
    PAD.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (z: number) =>
    PAD.t + (1 - (Math.max(zMin, Math.min(zMax, z)) - zMin) / (zMax - zMin)) * (H - PAD.t - PAD.b);

  const latest = pts.length > 0 ? pts[pts.length - 1].z : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{label}</span>
        <span className={cn('text-xs font-semibold tabular-nums', zTone(latest))}>{fmtZ(latest)}</span>
      </div>
      {pts.length === 0 ? (
        <div className="flex h-[104px] items-center justify-center text-xs text-ink-faint">
          {t('caseDetail.noPlotData')}
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* reference bands */}
          {[
            { z: 0, cls: 'stroke-border', dash: '' },
            { z: 2, cls: 'stroke-amber-400/70', dash: '3 3' },
            { z: -2, cls: 'stroke-amber-400/70', dash: '3 3' },
            { z: 3, cls: 'stroke-coral-400/70', dash: '2 3' },
            { z: -3, cls: 'stroke-coral-400/70', dash: '2 3' },
          ].map(l => (
            <g key={l.z}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(l.z)} y2={sy(l.z)} className={l.cls} strokeDasharray={l.dash} />
              <text x={2} y={sy(l.z) + 3} className="fill-current text-ink-faint" fontSize={8}>
                {l.z > 0 ? `+${l.z}` : l.z}
              </text>
            </g>
          ))}
          {pts.length > 1 && (
            <polyline
              points={pts.map(p => `${sx(p.x)},${sy(p.z)}`).join(' ')}
              fill="none"
              className="stroke-primary"
              strokeWidth={1.6}
            />
          )}
          {pts.map((p, i) => (
            <circle key={i} cx={sx(p.x)} cy={sy(p.z)} r={2.4} className="fill-primary">
              <title>{`z ${fmtZ(p.z)}`}</title>
            </circle>
          ))}
        </svg>
      )}
    </div>
  );
};

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
        <div className="grid gap-4 xl:grid-cols-[232px_minmax(0,1fr)_252px]">
          {/* ── LEFT: activity + outcome histograms ─────────────────────────── */}
          <aside className="order-2 space-y-2 xl:order-1">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
              <BarChart3 className="size-3.5" />
              {t('caseDetail.metrics')}
            </div>
            <ActivityBars label={t('summary.groups.total')} block={row.activities.total} />
            <div className="rounded-lg border border-border bg-surface p-2.5">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                {t('summary.groups.outcomes')}
              </div>
              <div className="flex gap-2">
                <OutcomeBars label="W" triplet={row.outcomes.wfaz} />
                <OutcomeBars label="H" triplet={row.outcomes.hfaz} />
                <OutcomeBars label="WH" triplet={row.outcomes.wfhz} />
              </div>
            </div>
            <ActivityBars label="CG" block={row.activities.cg} />
            <ActivityBars label="BF" block={row.activities.bf} />
            <ActivityBars label="CF" block={row.activities.cf} />
          </aside>

          {/* ── CENTER: identity sections + visits ──────────────────────────── */}
          <div className="order-1 min-w-0 xl:order-2">
            <div className="mb-4 space-y-2">
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
                  { label: t('summary.adoptionType'), value: row.case_details.adoption_type ?? '—' },
                  { label: t('summary.adoptAgeFull'), value: fmtMonths(row.case_details.age_of_adoption_days) },
                  { label: t('summary.durationFull'), value: fmtMonths(row.case_details.adoption_duration_days) },
                ]}
              />
            </div>

            {detail && (
              <>
                {/* visits */}
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
              </>
            )}
          </div>

          {/* ── RIGHT: z-score trend plots ──────────────────────────────────── */}
          <aside className="order-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
              <LineChart className="size-3.5" />
              {t('caseDetail.zTrends')}
            </div>
            <ZTrendPlot label={t('summary.wfaz')} visits={detail?.visits ?? []} pick={v => v.z.wfaz} />
            <ZTrendPlot label={t('summary.hfaz')} visits={detail?.visits ?? []} pick={v => v.z.hfaz} />
            <ZTrendPlot label={t('summary.wfhz')} visits={detail?.visits ?? []} pick={v => v.z.wfhz} />
          </aside>
        </div>
      )}
    </Modal>
  );
};

export default CaseDetailModal;
