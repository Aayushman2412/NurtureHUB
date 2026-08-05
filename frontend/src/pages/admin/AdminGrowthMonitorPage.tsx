import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Download } from 'lucide-react';
import client from '../../api/client';
import {
  getAdminGrowthMonitor,
  getAdminGrowthResponse,
  getAdminGrowthSummary,
  getGrowthStandards,
  getGrowthSummaryFilters,
  getGrowthAlerts,
  downloadGrowthSummaryXlsx,
  type GrowthCase,
  type GrowthFilters,
  type GrowthStandards,
  type GrowthSummaryFilterOptions,
  type GrowthSummaryRow,
  type ProteinAlert,
} from '../../api/growth';
import GrowthChartGrid, { GrowthLegend } from '../../components/growth/GrowthChartGrid';
import GrowthSummaryTable from '../../components/growth/GrowthSummaryTable';
import VisitDetailModal from '../../components/growth/VisitDetailModal';
import { Button, EmptyState, PageLoader, SearchableSelect, SelectField, Tabs } from '../../components/ui';
import { downloadChartsCombined } from '../../lib/chartExport';
import { sexKeyForGender, type GrowthPoint } from '../../lib/growthChart';

interface ProgramDistrict {
  id: number;
  name: string;
  slug: string;
}

const EMPTY_OPTIONS: GrowthSummaryFilterOptions = { learners: [], roles: [], departments: [] };

/**
 * Admin Growth Monitor. Two views over the same filtered case set:
 *  - a learner-level SUMMARY TABLE (default): activity completion (EC/AC/IC per
 *    form) + WFAz/HFAz outcomes per learner-mother-child case, and
 *  - the WHO growth CHARTS (expandable + downloadable).
 * Filters: district, role, department and a single learner apply to both.
 */
const AdminGrowthMonitorPage: React.FC = () => {
  const { t } = useTranslation('growth');

  const [view, setView] = useState<'table' | 'charts'>('table');
  const [filters, setFilters] = useState<GrowthFilters>({});
  const [options, setOptions] = useState<GrowthSummaryFilterOptions>(EMPTY_OPTIONS);
  const [districts, setDistricts] = useState<ProgramDistrict[]>([]);

  const [rows, setRows] = useState<GrowthSummaryRow[]>([]);
  const [summaryMock, setSummaryMock] = useState(false);
  const [cases, setCases] = useState<GrowthCase[]>([]);

  const [alerts, setAlerts] = useState<ProteinAlert[]>([]);
  const [standards, setStandards] = useState<GrowthStandards | null>(null);
  const [standardsError, setStandardsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  const [sexTab, setSexTab] = useState<'boys' | 'girls'>('boys');
  const [detailPoint, setDetailPoint] = useState<GrowthPoint | null>(null);
  // Charts-only narrowing to a single mother–learner pair (one case).
  const [pairChildId, setPairChildId] = useState<number | null>(null);
  const chartsRef = useRef<HTMLDivElement>(null);

  const loadStandards = useCallback(() => {
    setStandardsError(false);
    getGrowthStandards()
      .then(setStandards)
      .catch(() => setStandardsError(true));
  }, []);

  useEffect(() => {
    loadStandards();
    getGrowthSummaryFilters().then(setOptions).catch(() => setOptions(EMPTY_OPTIONS));
    getGrowthAlerts().then(r => setAlerts(r.alerts)).catch(() => setAlerts([]));
    client
      .get<ProgramDistrict[]>('/api/admin/districts')
      .then(res => setDistricts(res.data))
      .catch(() => {});
  }, [loadStandards]);

  // Both views read the same filtered set; fetch both so switching tabs is instant.
  // `active` guards against out-of-order responses when filters change quickly:
  // only the latest request's results (and its blank-on-error) are applied.
  useEffect(() => {
    let active = true;
    setDataLoading(true);
    Promise.all([getAdminGrowthSummary(filters), getAdminGrowthMonitor(filters)])
      .then(([summary, monitor]) => {
        if (!active) return;
        setRows(summary.rows);
        setSummaryMock(summary.mock);
        setCases(monitor.cases);
      })
      .catch(() => {
        if (!active) return;
        setRows([]);
        setCases([]);
      })
      .finally(() => {
        if (!active) return;
        setDataLoading(false);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters]);

  const patch = (p: Partial<GrowthFilters>) => setFilters(f => ({ ...f, ...p }));
  const resetFilters = () => setFilters({});

  // A stale pair pick would silently blank the charts once the shared filters
  // exclude that case — changing any filter clears the pair narrowing.
  useEffect(() => {
    setPairChildId(null);
  }, [filters]);
  const hasFilters = !!(filters.district || filters.role || filters.department || filters.learnerId);

  // The optional pair filter narrows the charts to one case before sex-splitting.
  const pairCases = useMemo(
    () => (pairChildId ? cases.filter(c => c.child.id === pairChildId) : cases),
    [cases, pairChildId],
  );
  const sexCases = useMemo(
    () => pairCases.filter(c => sexKeyForGender(c.child.gender) === sexTab),
    [pairCases, sexTab],
  );
  const counts = useMemo(
    () => ({
      boys: pairCases.filter(c => sexKeyForGender(c.child.gender) === 'boys').length,
      girls: pairCases.filter(c => sexKeyForGender(c.child.gender) === 'girls').length,
    }),
    [pairCases],
  );
  const pairOptions = useMemo(
    () =>
      [...cases]
        .sort((a, b) => (a.mother.name || '').localeCompare(b.mother.name || ''))
        .map(c => ({
          value: c.child.id,
          label: `${c.mother.name} — ${c.learner?.name ?? t('admin.orphanLearner')} (${c.child.name})`,
        })),
    [cases, t],
  );

  // Auto-jump the sex tab so a picked pair is never hidden behind the wrong tab.
  useEffect(() => {
    if (!pairChildId) return;
    const picked = cases.find(c => c.child.id === pairChildId);
    const key = picked ? sexKeyForGender(picked.child.gender) : null;
    if (key) setSexTab(key);
  }, [pairChildId, cases]);

  const fetchResponse = useCallback((id: number) => getAdminGrowthResponse(id), []);

  const downloadAllCharts = useCallback(async () => {
    const container = chartsRef.current;
    if (!container) return;
    const svgs = Array.from(container.querySelectorAll<SVGSVGElement>('svg[data-growth-chart]'));
    await downloadChartsCombined(svgs, `growth-charts-${sexTab}.png`);
  }, [sexTab]);

  if (standardsError && !standards) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-8" />}
        title={t('errors.loadFailedTitle')}
        description={t('errors.loadFailedBody')}
        action={<Button onClick={loadStandards}>{t('errors.retry')}</Button>}
      />
    );
  }

  if (loading || !standards) {
    return <PageLoader label={t('admin.loading')} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-ink">{t('admin.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('admin.description')}</p>
      </div>

      {/* Implausibly high protein totals — flagged to the team at submit time
          and listed here so they can be worked through. */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-error-500/40 bg-error-50 p-4 dark:bg-error-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4.5 shrink-0 text-error-600" />
            <h2 className="font-display text-sm font-bold text-ink">
              {t('admin.proteinAlertsTitle', { count: alerts.length })}
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{t('admin.proteinAlertsSub')}</p>
          <ul className="mt-2.5 space-y-1 text-sm">
            {alerts.map(a => (
              <li key={a.response_id} className="flex flex-wrap items-baseline gap-x-2 text-ink-muted">
                <b className="tabular-nums text-error-600">{a.total24}g</b>
                <span className="text-ink">{a.mother_name ?? '—'}</span>
                <span className="text-ink-faint">·</span>
                <span>{a.learner_name ?? '—'}</span>
                <span className="text-ink-faint">·</span>
                <span className="tabular-nums">{a.assessment_date ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* filters — apply to both the table and the charts */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label={t('admin.district')}
            value={filters.district ?? ''}
            onChange={v => patch({ district: v })}
            placeholder={t('admin.allDistricts')}
            options={districts.map(d => ({ value: d.slug, label: d.name }))}
          />
          <SelectField
            label={t('filters.role')}
            value={filters.role ?? ''}
            onChange={v => patch({ role: v })}
            placeholder={t('filters.allRoles')}
            options={options.roles.map(r => ({ value: r, label: r }))}
          />
          <SelectField
            label={t('filters.department')}
            value={filters.department ?? ''}
            onChange={v => patch({ department: v })}
            placeholder={t('filters.allDepartments')}
            options={options.departments.map(d => ({ value: d, label: d }))}
          />
          <SearchableSelect
            label={t('filters.learner')}
            value={filters.learnerId ?? ''}
            onChange={v => patch({ learnerId: v ? Number(v) : null })}
            placeholder={t('filters.allLearners')}
            emptyMessage={t('filters.noLearners')}
            options={[
              { value: '', label: t('filters.allLearners') },
              ...options.learners.map(l => ({
                value: l.id,
                label: l.district ? `${l.name} · ${l.district}` : l.name,
              })),
            ]}
          />
        </div>
        {hasFilters && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="ghost" onClick={resetFilters}>
              {t('filters.clear')}
            </Button>
          </div>
        )}
      </div>

      <Tabs
        value={view}
        onChange={setView}
        items={[
          { value: 'table' as const, label: t('summary.tab') },
          { value: 'charts' as const, label: t('charts.tab') },
        ]}
      />

      {view === 'table' ? (
        <GrowthSummaryTable
          rows={rows}
          mock={summaryMock}
          // The full drill-down is a page of its own — open it in a new tab.
          onRowClick={row => window.open(`/admin/growth/cases/${row.case_id}`, '_blank', 'noopener')}
          onDownloadXlsx={() => downloadGrowthSummaryXlsx(filters)}
        />
      ) : (
        <div className="space-y-5">
          <GrowthLegend />

          {/* charts-only: narrow to a single mother–learner pair */}
          <div className="max-w-md">
            <SearchableSelect
              label={t('charts.pairFilter')}
              value={pairChildId ?? ''}
              onChange={v => setPairChildId(v ? Number(v) : null)}
              placeholder={t('charts.allPairs')}
              emptyMessage={t('admin.noCases')}
              options={[{ value: '', label: t('charts.allPairs') }, ...pairOptions]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={sexTab}
              onChange={setSexTab}
              items={[
                { value: 'boys' as const, label: `${t('sexTabs.boys')} (${counts.boys})` },
                { value: 'girls' as const, label: `${t('sexTabs.girls')} (${counts.girls})` },
              ]}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={downloadAllCharts}
              disabled={sexCases.length === 0}
            >
              <Download className="size-4" />
              {t('charts.downloadAll')}
            </Button>
          </div>

          {sexCases.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-8" />}
              title={t('admin.noCasesTitle')}
              description={t('admin.noCases')}
            />
          ) : (
            <div ref={chartsRef}>
              <GrowthChartGrid
                cases={sexCases}
                sex={sexTab}
                standards={standards}
                onPointClick={setDetailPoint}
              />
            </div>
          )}
        </div>
      )}

      {dataLoading && <p className="text-xs text-ink-faint">{t('admin.loading')}</p>}

      <VisitDetailModal
        point={detailPoint}
        onClose={() => setDetailPoint(null)}
        fetchResponse={fetchResponse}
      />
    </div>
  );
};

export default AdminGrowthMonitorPage;
