import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Baby,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  LineChart,
  Stethoscope,
  User,
} from 'lucide-react';
import {
  getAdminGrowthMonitor,
  getAdminGrowthResponse,
  getAdminGrowthSummary,
  getGrowthCaseDetail,
  getGrowthStandards,
  type GrowthCase,
  type GrowthCaseDetail,
  type GrowthStandards,
  type GrowthSummaryRow,
} from '../../api/growth';
import type { FormKey, FormResponseDetail } from '../../lib/flowTypes';
import { adoptionCategory, lapCellFill, monthsDays } from '../../lib/growthDisplay';
import { sexKeyForGender, type GrowthPoint } from '../../lib/growthChart';
import GrowthChartGrid, { GrowthLegend } from '../../components/growth/GrowthChartGrid';
import VisitDetailModal from '../../components/growth/VisitDetailModal';
import VisitSummaryTable, { GREEN_INK, RED_INK } from '../../components/growth/VisitSummaryTable';
import ResponseDetailCard from '../../components/growth/ResponseDetailCard';
import { ChartCard, ActivityComparisonChart, OutcomeDivergingChart } from '../../components/growth/CaseCharts';
import { Badge, Button, EmptyState, PageHeader, PageLoader } from '../../components/ui';
import { cn } from '../../utils/cn';

/** Forms scored against the LAP (question × visit matrices). */
const LAP_FORMS: FormKey[] = ['breastfeeding', 'complementary_feeding'];
/** Informational forms — no as-per-LAP tracker; listed date-wise instead. */
const INFO_FORMS: FormKey[] = ['growth_monitoring', 'mother_protein_intake', 'antenatal'];

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
    <span className="text-sm font-medium text-ink">{value}</span>
  </div>
);

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

const FORM_CODES: Record<string, string> = {
  growth_monitoring: 'CG',
  breastfeeding: 'BF',
  complementary_feeding: 'CF',
  mother_protein_intake: 'PI',
  antenatal: 'ANC',
};

// ── question × visit LAP matrix ──────────────────────────────────────────────

type MatrixCell = 'green' | 'red' | 'neutral' | null;

interface MatrixData {
  dates: string[];
  rows: { key: string; question: string; cells: Record<string, MatrixCell> }[];
}

/** rows = every question ever asked (first-seen order); cols = visit dates. */
const buildMatrix = (responses: FormResponseDetail[]): MatrixData => {
  const sorted = [...responses].sort(
    (a, b) => a.assessment_date.localeCompare(b.assessment_date) || a.id - b.id,
  );
  const dates: string[] = [];
  const rows = new Map<string, { key: string; question: string; cells: Record<string, MatrixCell> }>();
  for (const response of sorted) {
    if (!dates.includes(response.assessment_date)) dates.push(response.assessment_date);
    for (const answer of response.answers_json) {
      const key = answer.nodeId || answer.question;
      if (!rows.has(key)) rows.set(key, { key, question: answer.question, cells: {} });
      const verdicts = (answer.selected ?? []).map(s => s.verdict).filter(Boolean);
      const answered = answer.value != null || (answer.selected?.length ?? 0) > 0;
      const cell: MatrixCell = verdicts.includes('red')
        ? 'red'
        : verdicts.includes('green')
          ? 'green'
          : answered
            ? 'neutral'
            : null;
      // Same-date resubmission: the later (higher id) response wins.
      rows.get(key)!.cells[response.assessment_date] = cell;
    }
  }
  return { dates, rows: [...rows.values()] };
};

/** Every cell is gridded and carries its own glyph: ✓ as per LAP, ✕ not. */
const LapMatrix: React.FC<{ matrix: MatrixData }> = ({ matrix }) => {
  const { t } = useTranslation('growth');
  const cellTitle = (cell: MatrixCell) =>
    cell === 'green'
      ? t('casePage.legendGreen')
      : cell === 'red'
        ? t('casePage.legendRed')
        : cell === 'neutral'
          ? t('casePage.legendNeutral')
          : t('casePage.legendNotAsked');

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border-strong">
      <table
        className="border-collapse text-sm [&_td]:border [&_td]:border-border-strong [&_th]:border [&_th]:border-border-strong"
        style={{ width: 'max-content', minWidth: '100%' }}
      >
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-10 w-12 bg-surface-sunken px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              #
            </th>
            <th className="sticky left-12 z-10 min-w-44 max-w-60 md:min-w-72 md:max-w-96 bg-surface-sunken px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              {t('casePage.question')}
            </th>
            {matrix.dates.map(date => (
              <th
                key={date}
                className="whitespace-nowrap bg-surface-sunken px-3 py-2 text-center text-[11px] font-semibold text-ink-muted"
              >
                {date}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row, index) => (
            <tr key={row.key}>
              <td className="sticky left-0 z-10 w-12 bg-surface px-2 py-1.5 text-right text-[11px] tabular-nums text-ink-faint">
                {index + 1}
              </td>
              <td className="sticky left-12 z-10 min-w-44 max-w-60 md:min-w-72 md:max-w-96 bg-surface px-3 py-1.5 text-[13px] text-ink">
                {row.question}
              </td>
              {matrix.dates.map(date => {
                const cell = row.cells[date] ?? null;
                return (
                  <td
                    key={date}
                    title={cellTitle(cell)}
                    className={cn(
                      'px-3 py-1.5 text-center text-base font-bold leading-none',
                      cell === 'green' && GREEN_INK,
                      cell === 'red' && RED_INK,
                    )}
                    // A light wash, not a solid fill: the ✓/✕ glyph has to stay
                    // readable on top of it in both themes.
                    style={{ backgroundColor: cell === 'neutral' ? undefined : lapCellFill(cell, true) }}
                  >
                    {cell === 'green' ? '✓' : cell === 'red' ? '✕' : cell === 'neutral' ? '•' : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** A collapsible section with a count badge. */
const Expandable: React.FC<{
  title: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, badge, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 bg-surface-sunken px-3 py-2 text-left transition-colors hover:bg-surface-sunken/70"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-ink-muted" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-ink-muted" />
        )}
        <span className="flex-1 text-sm font-semibold text-ink">{title}</span>
        {badge}
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
};

// ── page ─────────────────────────────────────────────────────────────────────

/**
 * Full-page case drill-down, opened in a NEW TAB from a summary-table row.
 * Top-to-bottom: identity → activity/outcome charts → the case's own WHO
 * growth charts → per-visit summary table → info forms (date-wise) → one
 * question × visit LAP matrix per assessment form.
 */
const AdminGrowthCasePage: React.FC = () => {
  const { childId } = useParams<{ childId: string }>();
  const caseId = Number(childId);
  const { t } = useTranslation('growth');

  const [row, setRow] = useState<GrowthSummaryRow | null>(null);
  const [detail, setDetail] = useState<GrowthCaseDetail | null>(null);
  const [whoCase, setWhoCase] = useState<GrowthCase | null>(null);
  const [standards, setStandards] = useState<GrowthStandards | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [detailPoint, setDetailPoint] = useState<GrowthPoint | null>(null);

  useEffect(() => {
    if (!Number.isFinite(caseId)) {
      setState('error');
      return;
    }
    let cancelled = false;
    setState('loading');
    Promise.all([
      getAdminGrowthSummary({}),
      getGrowthCaseDetail(caseId),
      getAdminGrowthMonitor({ childId: caseId }),
      getGrowthStandards(),
    ])
      .then(([summary, caseDetail, monitor, whoStandards]) => {
        if (cancelled) return;
        setRow(summary.rows.find(r => r.case_id === caseId) ?? null);
        setDetail(caseDetail);
        setWhoCase(monitor.cases[0] ?? null);
        setStandards(whoStandards);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const fetchResponse = useCallback((id: number) => getAdminGrowthResponse(id), []);

  /** All responses of one form key across the case (child visits + mother forms). */
  const responsesByForm = useMemo(() => {
    const map = new Map<string, FormResponseDetail[]>();
    const push = (r: FormResponseDetail) => {
      const list = map.get(r.form_key) ?? [];
      list.push(r);
      map.set(r.form_key, list);
    };
    detail?.visits.forEach(v => v.responses.forEach(push));
    detail?.mother_forms.forEach(push);
    return map;
  }, [detail]);

  const infoResponses = useMemo(
    () =>
      INFO_FORMS.flatMap(key => responsesByForm.get(key) ?? []).sort(
        (a, b) => b.assessment_date.localeCompare(a.assessment_date) || b.id - a.id,
      ),
    [responsesByForm],
  );

  const fmtMonthsDays = (days: number | null) => {
    if (days == null) return '—';
    if (days < 0) return t('summary.antenatalShort');
    const v = monthsDays(days)!;
    return `${v.m}${t('summary.monthShort')} ${v.d}${t('summary.dayShort')}`;
  };

  if (state === 'loading') return <PageLoader label={t('casePage.loading')} />;

  if (state === 'error' || !detail) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-8" />}
        title={t('casePage.notFound')}
        action={
          <Button onClick={() => window.location.reload()}>{t('errors.retry')}</Button>
        }
      />
    );
  }

  const adoptCat = row ? adoptionCategory(row.case_details.age_of_adoption_days) : null;
  // null = gender unknown → the WHO charts cannot be plotted for this child.
  const sex = sexKeyForGender(detail.child.gender);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin/growth"
        title={
          <span className="flex flex-wrap items-center gap-x-2">
            {t('casePage.title')}
            <span className="font-mono text-base text-ink-muted">{detail.child.uid}</span>
          </span>
        }
        description={`${detail.mother?.name ?? ''} · ${detail.learner?.name ?? t('admin.orphanLearner')}`}
      />

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
            {
              label: t('summary.type'),
              value: adoptCat ? t(`summary.cat.${adoptCat}`) : (row?.case_details.adoption_type ?? '—'),
            },
            { label: t('summary.adoptAgeFull'), value: fmtMonthsDays(row?.case_details.age_of_adoption_days ?? null) },
            { label: t('summary.durationFull'), value: fmtMonthsDays(row?.case_details.adoption_duration_days ?? null) },
          ]}
        />
      </div>

      {/* ── activity + outcome charts ────────────────────────────────────── */}
      {row && (
        <section>
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
          <LineChart className="size-3.5" />
          {t('casePage.whoCharts')}
        </div>
        {whoCase && standards && sex ? (
          <div className="space-y-4">
            <GrowthLegend />
            <GrowthChartGrid
              cases={[whoCase]}
              sex={sex}
              standards={standards}
              onPointClick={setDetailPoint}
            />
          </div>
        ) : (
          <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">
            {sex ? t('learner.noVisits') : t('learner.noGender')}
          </p>
        )}
      </section>

      {/* ── per-visit summary table ──────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
          <Baby className="size-4 text-ink-muted" />
          {t('casePage.visitSummary')} ({detail.visits.length})
        </div>
        {detail.visits.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">
            {t('caseDetail.noVisits')}
          </p>
        ) : (
          <VisitSummaryTable visits={detail.visits} />
        )}
      </section>

      {/* ── one LAP matrix per assessment form (sits under the visit table
             so the per-question detail follows its own summary row) ─────── */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
          <BarChart3 className="size-4 text-ink-muted" />
          {t('casePage.lapMatrices')}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1">
            <span className="font-bold text-success-600">✓</span> {t('casePage.legendGreen')}
          </span>
          <span className="flex items-center gap-1">
            <span className="font-bold text-coral-700">✕</span> {t('casePage.legendRed')}
          </span>
          <span className="flex items-center gap-1">
            <span className="font-bold text-ink-muted">•</span> {t('casePage.legendNeutral')}
          </span>
          <span className="flex items-center gap-1">
            <span className="font-bold text-ink-faint">—</span> {t('casePage.legendNotAsked')}
          </span>
        </div>
        <div className="space-y-2">
          {LAP_FORMS.map(formKey => {
            const responses = responsesByForm.get(formKey) ?? [];
            if (responses.length === 0) return null;
            const matrix = buildMatrix(responses);
            return (
              <Expandable
                key={formKey}
                title={t(`forms.${formKey}`, { defaultValue: formKey })}
                badge={<Badge variant="neutral">{t('casePage.matrixCount', { count: matrix.dates.length })}</Badge>}
              >
                <LapMatrix matrix={matrix} />
              </Expandable>
            );
          })}
          {LAP_FORMS.every(k => (responsesByForm.get(k) ?? []).length === 0) && (
            <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">
              {t('casePage.noResponses')}
            </p>
          )}
        </div>
      </section>

      {/* ── info forms (no LAP tracker) — date-wise, expandable ──────────── */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
          <ClipboardList className="size-4 text-ink-muted" />
          {t('casePage.infoForms')} ({infoResponses.length})
        </div>
        {infoResponses.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">
            {t('casePage.noResponses')}
          </p>
        ) : (
          <div className="space-y-2">
            {infoResponses.map((response, index) => (
              <Expandable
                key={response.id}
                title={
                  <>
                    <span className="mr-2 tabular-nums text-ink-faint">{index + 1}.</span>
                    {response.assessment_date}
                    <span className="ml-2 font-normal text-ink-muted">
                      {t(`forms.${response.form_key}`, { defaultValue: response.form_key })}
                    </span>
                  </>
                }
                badge={<Badge variant="neutral">{FORM_CODES[response.form_key] ?? response.form_key}</Badge>}
              >
                <ResponseDetailCard detail={response} />
              </Expandable>
            ))}
          </div>
        )}
      </section>

      <VisitDetailModal point={detailPoint} onClose={() => setDetailPoint(null)} fetchResponse={fetchResponse} />
    </div>
  );
};

export default AdminGrowthCasePage;
