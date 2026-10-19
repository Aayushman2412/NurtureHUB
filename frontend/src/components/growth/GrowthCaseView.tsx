import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Baby, BarChart3, ChevronDown, ChevronRight, ClipboardList, Download, LineChart, Stethoscope, User,
} from 'lucide-react';
import {
  getAdminGrowthMonitor, getAdminGrowthResponse, getAdminGrowthSummary, getGrowthCaseDetail,
  getGrowthStandards, getMyGrowthCaseDetail,
  type GrowthCase, type GrowthCaseDetail, type GrowthStandards, type GrowthSummaryRow,
} from '../../api/growth';
import { getResponse } from '../../api/forms';
import type { FormKey, FormResponseDetail } from '../../lib/flowTypes';
import { caseCategory, monthsDays } from '../../lib/growthDisplay';
import { sexKeyForGender, type GrowthPoint } from '../../lib/growthChart';
import GrowthChartGrid, { GrowthLegend } from './GrowthChartGrid';
import VisitDetailModal from './VisitDetailModal';
import VisitSummaryTable from './VisitSummaryTable';
import VisitMatrix from './VisitMatrix';
import { ChartCard, ActivityComparisonChart, OutcomeDivergingChart } from './CaseCharts';
import { RotateHint, TablePictureButton } from './TableTools';
import { Badge, Button, EmptyState, PageHeader, PageLoader } from '../ui';

/** Forms scored against the LAP. */
const LAP_FORMS: FormKey[] = ['breastfeeding', 'complementary_feeding'];
/** The other forms — what was recorded, visit by visit. */
const INFO_FORMS: FormKey[] = ['growth_monitoring', 'mother_protein_intake', 'antenatal'];

const FORM_CODES: Record<string, string> = {
  growth_monitoring: 'CG', breastfeeding: 'BF', complementary_feeding: 'CF',
  mother_protein_intake: 'PI', antenatal: 'ANC',
};

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-[12px] uppercase tracking-wide text-ink-faint">{label}</span>
    <span className="text-sm font-medium text-ink">{value}</span>
  </div>
);

const IdentitySection: React.FC<{ icon: React.ReactNode; title: string; facts: { label: string; value: React.ReactNode }[] }> = ({
  icon, title, facts,
}) => (
  <div className="rounded-lg border border-border bg-surface-sunken/60 p-3">
    <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">{icon}{title}</div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {facts.map(f => <Fact key={f.label} label={f.label} value={f.value} />)}
    </div>
  </div>
);

/** A collapsible section with a count badge. `forceOpen` opens it for the
 *  page download, so the PDF holds every table. */
const Expandable: React.FC<{
  title: React.ReactNode; badge?: React.ReactNode; defaultOpen?: boolean; forceOpen?: boolean; children: React.ReactNode;
}> = ({
  title, badge, defaultOpen = false, forceOpen = false, children,
}) => {
  const [isOpen, setOpen] = useState(defaultOpen);
  const open = isOpen || forceOpen;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 bg-surface-sunken px-3 py-2 text-left transition-colors hover:bg-surface-sunken/70"
      >
        {open ? <ChevronDown className="size-4 shrink-0 text-ink-muted" /> : <ChevronRight className="size-4 shrink-0 text-ink-muted" />}
        <span className="flex-1 text-sm font-semibold text-ink">{title}</span>
        {badge}
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
};

interface Loaded {
  row: GrowthSummaryRow | null;
  detail: GrowthCaseDetail;
  whoCase: GrowthCase | null;
  standards: GrowthStandards;
}

/**
 * One learner–mother–child case, top to bottom: identity → activity and
 * outcome charts → the case's WHO growth charts → per-visit summary → every
 * form as a question × visit table (reviews of 17 Oct 2026).
 *
 * `admin`: the supervisors' drill-down (opened from Learner Activities).
 * `learner`: the same page for a learner's own case — Sir: "all of these,
 * whatever is there in this page, must be visible for the learner … the
 * ability to take decisions should go to the learner: what is happening
 * between two visits, how am I progressing". Read-only in both.
 */
const GrowthCaseView: React.FC<{ childId: number; mode: 'admin' | 'learner'; backTo: string }> = ({ childId, mode, backTo }) => {
  const { t } = useTranslation('growth');
  const [data, setData] = useState<Loaded | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [detailPoint, setDetailPoint] = useState<GrowthPoint | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // The whole page as one document (review of 19 Oct 2026: "I would be happy
  // if I get a download button for this whole page ... it shows the project's
  // activities and the results both in a single document"). Every section is
  // opened, then the browser's print dialog saves it as a PDF.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const id = window.setTimeout(() => window.print(), 300);
    return () => { window.clearTimeout(id); window.removeEventListener('afterprint', done); };
  }, [printing]);

  useEffect(() => {
    if (!Number.isFinite(childId)) { setState('error'); return; }
    let cancelled = false;
    setState('loading');
    const load: Promise<Loaded> = mode === 'learner'
      ? Promise.all([getMyGrowthCaseDetail(childId), getGrowthStandards()]).then(([d, standards]) => ({
        row: d.summary, detail: d, whoCase: d.who_case, standards,
      }))
      : Promise.all([
        getAdminGrowthSummary({}), getGrowthCaseDetail(childId),
        getAdminGrowthMonitor({ childId }), getGrowthStandards(),
      ]).then(([summary, detail, monitor, standards]) => ({
        row: summary.rows.find(r => r.case_id === childId) ?? null, detail,
        whoCase: monitor.cases[0] ?? null, standards,
      }));
    load
      .then(d => { if (!cancelled) { setData(d); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [childId, mode]);

  const fetchResponse = useCallback(
    (id: number) => (mode === 'learner' ? getResponse(id) : getAdminGrowthResponse(id)),
    [mode],
  );

  /** All responses of one form across the case (child visits + mother forms). */
  const responsesByForm = useMemo(() => {
    const map = new Map<string, FormResponseDetail[]>();
    const push = (r: FormResponseDetail) => map.set(r.form_key, [...(map.get(r.form_key) ?? []), r]);
    data?.detail.visits.forEach(v => v.responses.forEach(push));
    data?.detail.mother_forms.forEach(push);
    return map;
  }, [data]);

  const fmtMonthsDays = (days: number | null) => {
    if (days == null) return '—';
    if (days < 0) return t('summary.antenatalShort');
    const v = monthsDays(days)!;
    return `${v.m}${t('summary.monthShort')} ${v.d}${t('summary.dayShort')}`;
  };

  if (state === 'loading') return <PageLoader label={t('casePage.loading')} />;
  if (state === 'error' || !data) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-8" />}
        title={t('casePage.notFound')}
        action={<Button onClick={() => window.location.reload()}>{t('errors.retry')}</Button>}
      />
    );
  }

  const { row, detail, whoCase, standards } = data;
  const adoptCat = row ? caseCategory(row.case_details.adoption_type, row.case_details.age_of_adoption_days) : null;
  const sex = sexKeyForGender(detail.child.gender);   // null = the WHO charts cannot be plotted
  const formTables = (keys: FormKey[]) => keys
    .map(key => ({ key, responses: responsesByForm.get(key) ?? [] }))
    .filter(f => f.responses.length > 0);
  const lapTables = formTables(LAP_FORMS);
  const infoTables = formTables(INFO_FORMS);
  const visitCount = (rs: FormResponseDetail[]) => new Set(rs.map(r => r.assessment_date)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={backTo}
        title={
          <span className="flex flex-wrap items-center gap-x-2">
            {t('casePage.title')}
            <span className="font-mono text-base text-ink-muted">{detail.child.uid}</span>
          </span>
        }
        description={mode === 'learner'
          ? `${detail.mother?.name ?? ''} · ${detail.child.name ?? ''}`
          : `${detail.mother?.name ?? ''} · ${detail.learner?.name ?? t('admin.orphanLearner')}`}
        actions={
          <span className="print-hidden flex flex-col items-end gap-1">
            <Button variant="outline" size="sm" iconLeft={<Download className="size-4" />} onClick={() => setPrinting(true)}>
              {t('casePage.downloadPage')}
            </Button>
            <span className="text-xs text-ink-faint">{t('casePage.downloadPageHint')}</span>
          </span>
        }
      />
      {/* Wide visit tables need the width of a landscape page. */}
      {printing && <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>}

      {/* ── identity ─────────────────────────────────────────────────────── */}
      <div className="grid gap-2 md:grid-cols-3">
        <IdentitySection
          icon={<Stethoscope className="size-3.5" />}
          title={t('caseDetail.learnerDetails')}
          facts={[
            { label: t('summary.learner'), value: detail.learner?.name ?? t('admin.orphanLearner') },
            { label: t('summary.role'), value: detail.learner?.role ?? '—' },
            { label: t('filters.department'), value: detail.learner?.department ?? '—' },
          ]}
        />
        <IdentitySection
          icon={<User className="size-3.5" />}
          title={t('caseDetail.motherDetails')}
          facts={[
            { label: t('summary.mother'), value: detail.mother?.name ?? '—' },
            { label: 'UID', value: <span className="font-mono text-xs">{detail.mother?.uid ?? '—'}</span> },
            { label: t('caseDetail.village'), value: detail.mother?.village ?? '—' },
            { label: t('caseDetail.mobile'), value: detail.mother?.mobile ?? '—' },
            { label: t('caseDetail.motherAge'), value: detail.mother?.age ?? '—' },
          ]}
        />
        <IdentitySection
          icon={<Baby className="size-3.5" />}
          title={t('caseDetail.childDetails')}
          facts={[
            { label: t('caseDetail.childName'), value: detail.child.name ?? '—' },
            { label: 'UID', value: <span className="font-mono text-xs">{detail.child.uid}</span> },
            { label: t('caseDetail.gender'), value: detail.child.gender ?? '—' },
            { label: t('caseDetail.born'), value: detail.child.dob ?? '—' },
            { label: t('summary.type'), value: adoptCat ? t(`summary.cat.${adoptCat}`) : (row?.case_details.adoption_type ?? '—') },
            { label: t('summary.adoptAgeFull'), value: fmtMonthsDays(row?.case_details.age_of_adoption_days ?? null) },
            { label: t('summary.durationFull'), value: fmtMonthsDays(row?.case_details.adoption_duration_days ?? null) },
          ]}
        />
      </div>

      {/* ── activity + outcome charts ────────────────────────────────────── */}
      {row && (
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
            <BarChart3 className="size-3.5" />{t('caseDetail.metrics')}
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            <ChartCard
              title={t('caseDetail.activityChart')}
              description={t('casePage.explain.activity')}
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
              description={t('casePage.explain.outcomes')}
              render={ref => (
                <OutcomeDivergingChart
                  svgRef={ref}
                  outcomes={row.outcomes}
                  legend={{ wfaz: t('summary.wfaz'), hfaz: t('summary.hfaz'), wfhz: t('summary.wfhz') }}
                  visitLabels={{ bv: 'BV', av: 'AV', lv: 'LV' }}
                  direction={{ negative: t('chart.zNegative'), positive: t('chart.zPositive') }}
                />
              )}
            />
          </div>
        </section>
      )}

      {/* ── this pair's WHO growth charts ────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
          <LineChart className="size-3.5" />{t('casePage.whoCharts')}
        </div>
        <p className="mb-2 text-xs leading-snug text-ink-muted">{t('casePage.explain.who')}</p>
        {whoCase && sex ? (
          <div className="space-y-4">
            <GrowthLegend />
            <GrowthChartGrid cases={[whoCase]} sex={sex} standards={standards} onPointClick={setDetailPoint} />
          </div>
        ) : (
          <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">
            {sex ? t('learner.noVisits') : t('learner.noGender')}
          </p>
        )}
      </section>

      {/* ── per-visit summary table ──────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <Baby className="size-4 text-ink-muted" />{t('casePage.visitSummary')} ({detail.visits.length})
          </span>
          <RotateHint />
          {detail.visits.length > 0 && (
            <span className="ml-auto"><TablePictureButton target={summaryRef} title={t('casePage.visitSummary')} /></span>
          )}
        </div>
        {detail.visits.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">{t('caseDetail.noVisits')}</p>
        ) : (
          <div ref={summaryRef}><VisitSummaryTable visits={detail.visits} /></div>
        )}
      </section>

      {/* ── LAP forms: ✓ / ✕ per question, visits side by side ───────────── */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
          <BarChart3 className="size-4 text-ink-muted" />{t('casePage.lapMatrices')}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px] text-ink-muted">
          <span className="flex items-center gap-1"><span className="font-bold text-success-600">✓</span> {t('casePage.legendGreen')}</span>
          <span className="flex items-center gap-1"><span className="font-bold text-coral-700">✕</span> {t('casePage.legendRed')}</span>
          <span className="flex items-center gap-1"><span className="font-bold text-ink-faint">—</span> {t('casePage.legendNotAsked')}</span>
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-surface-sunken ring-1 ring-border" /> {t('casePage.legendNotYet')}</span>
        </div>
        <div className="space-y-2">
          {lapTables.map(({ key, responses }) => (
            <Expandable
              key={key} defaultOpen forceOpen={printing}
              title={t(`forms.${key}`, { defaultValue: key })}
              badge={<Badge variant="neutral">{t('casePage.matrixCount', { count: visitCount(responses) })}</Badge>}
            >
              <VisitMatrix responses={responses} title={t(`forms.${key}`, { defaultValue: key })} />
            </Expandable>
          ))}
          {lapTables.length === 0 && (
            <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">{t('casePage.noResponses')}</p>
          )}
        </div>
      </section>

      {/* ── the other forms: what was recorded, visits side by side ──────── */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
          <ClipboardList className="size-4 text-ink-muted" />{t('casePage.infoForms')}
        </div>
        <div className="space-y-2">
          {infoTables.map(({ key, responses }) => (
            <Expandable
              key={key} defaultOpen={key === 'growth_monitoring'} forceOpen={printing}
              title={<>{t(`forms.${key}`, { defaultValue: key })} <span className="ml-1 font-normal text-ink-muted">({FORM_CODES[key] ?? key})</span></>}
              badge={<Badge variant="neutral">{t('casePage.matrixCount', { count: visitCount(responses) })}</Badge>}
            >
              <VisitMatrix
                responses={responses} kind="values" title={t(`forms.${key}`, { defaultValue: key })}
                growth={key === 'growth_monitoring' ? detail.visits : undefined}
              />
            </Expandable>
          ))}
          {infoTables.length === 0 && (
            <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">{t('casePage.noResponses')}</p>
          )}
        </div>
      </section>

      <VisitDetailModal point={detailPoint} onClose={() => setDetailPoint(null)} fetchResponse={fetchResponse} />
    </div>
  );
};

export default GrowthCaseView;
