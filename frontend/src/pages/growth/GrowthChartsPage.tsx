import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, ChevronRight, LineChart, Table2 } from 'lucide-react';
import { getResponse } from '../../api/forms';
import {
  getGrowthStandards,
  getMyGrowthCases,
  getMyGrowthSummary,
  type GrowthCase,
  type GrowthStandards,
  type GrowthSummaryRow,
} from '../../api/growth';
import GrowthSummaryTable from '../../components/growth/GrowthSummaryTable';
import GrowthChartGrid, { GrowthLegend } from '../../components/growth/GrowthChartGrid';
import VisitDetailModal from '../../components/growth/VisitDetailModal';
import { Button, buttonClasses, EmptyState, PageHeader, PageLoader, Tabs } from '../../components/ui';
import MultiSelect from '../../components/ui/MultiSelect';
import { cn } from '../../utils/cn';
import {
  caseHasCohortData,
  sexKeyForGender,
  type GrowthCohort,
  type GrowthPoint,
} from '../../lib/growthChart';

/** The adoption types the charts can be narrowed to (review of 19 Oct 2026:
 *  "an ability to delineate ANC and PNC less than 5 in the filter"). */
const TYPE_FILTERS = ['all', 'anc', 'pnc_lt5', 'pnc_ge5'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

/**
 * Learner growth view: WHO growth charts for the learner's own cases —
 * per case (child) with only the applicable charts, several hand-picked cases
 * on the same charts, or all cases together; narrowed by adoption type.
 */
const GrowthChartsPage: React.FC = () => {
  const { t } = useTranslation('growth');
  const [searchParams, setSearchParams] = useSearchParams();

  const [standards, setStandards] = useState<GrowthStandards | null>(null);
  const [cases, setCases] = useState<GrowthCase[]>([]);
  const [rows, setRows] = useState<GrowthSummaryRow[]>([]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sexTab, setSexTab] = useState<'boys' | 'girls'>('boys');
  const [detailPoint, setDetailPoint] = useState<GrowthPoint | null>(null);

  // ?child=12 is one case; ?child=12,15 several on the same charts (review of
  // 19 Oct 2026: "ability to select multiple cases is essential ... same
  // graph"); none means all of them.
  const childParam = searchParams.get('child') ?? '';
  const pickedIds = useMemo(
    () => childParam.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0),
    [childParam],
  );
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // "My cases" (review of 17 Oct 2026): every case in one table, as the
  // supervisors see it — the first view; the WHO charts are the second.
  const view: 'table' | 'charts' = searchParams.get('view') === 'charts' || pickedIds.length > 0 ? 'charts' : 'table';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    Promise.all([getGrowthStandards(), getMyGrowthCases(), getMyGrowthSummary().catch(() => ({ rows: [], mock: false }))])
      .then(([std, mine, summary]) => {
        setStandards(std);
        setCases(mine.cases);
        setRows(summary.rows);
        const genders = new Set(mine.cases.map(c => sexKeyForGender(c.child.gender)));
        if (!genders.has('boys') && genders.has('girls')) setSexTab('girls');
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectCases = (ids: number[]) => {
    if (ids.length === 0) setSearchParams({ view: 'charts' });
    else setSearchParams({ child: ids.join(',') });
  };

  // One picked case: its own charts, whatever the type filter says.
  const selectedCase = useMemo(
    () => (pickedIds.length === 1 ? cases.find(c => c.child.id === pickedIds[0]) ?? null : null),
    [cases, pickedIds],
  );
  const typed = useMemo(
    () => cases.filter(c => typeFilter === 'all' || c.adoption_type === typeFilter),
    [cases, typeFilter],
  );
  // Several picked: those of them the type filter keeps; none picked: all.
  const pool = useMemo(
    () => (pickedIds.length > 1 ? typed.filter(c => pickedIds.includes(c.child.id)) : typed),
    [typed, pickedIds],
  );

  const allCasesForTab = useMemo(
    () => pool.filter(c => sexKeyForGender(c.child.gender) === sexTab),
    [pool, sexTab],
  );

  const counts = useMemo(
    () => ({
      boys: pool.filter(c => sexKeyForGender(c.child.gender) === 'boys').length,
      girls: pool.filter(c => sexKeyForGender(c.child.gender) === 'girls').length,
    }),
    [pool],
  );
  // Follow the cases: picking only girls should not leave the boys' tab open.
  useEffect(() => {
    if (counts[sexTab] === 0 && counts[sexTab === 'boys' ? 'girls' : 'boys'] > 0) {
      setSexTab(sexTab === 'boys' ? 'girls' : 'boys');
    }
  }, [counts, sexTab]);

  const fetchResponse = useCallback((id: number) => getResponse(id), []);

  if (loadError && !standards) {
    return (
      <>
        <PageHeader title={t('learner.title')} description={t('learner.description')} />
        <EmptyState
          icon={<AlertTriangle className="size-8" />}
          title={t('errors.loadFailedTitle')}
          description={t('errors.loadFailedBody')}
          action={<Button onClick={load}>{t('errors.retry')}</Button>}
        />
      </>
    );
  }

  if (loading || !standards) {
    return <PageLoader label={t('learner.loading')} />;
  }

  if (cases.length === 0) {
    return (
      <>
        <PageHeader title={t('learner.title')} description={t('learner.description')} />
        <EmptyState
          icon={<Activity className="size-8" />}
          title={t('learner.noCases')}
          description={t('learner.noCasesHint')}
          action={
            <Link to="/mothers" className={buttonClasses('primary', 'md')}>
              {t('learner.registerCta')}
            </Link>
          }
        />
      </>
    );
  }

  // Single-case view: only the charts that apply to this child — its sex, and
  // its ONE adoption cohort (a child adopted before 150 days stays on the
  // young charts for their whole follow-up), so 3 charts, never 6.
  const selectedSex = selectedCase ? sexKeyForGender(selectedCase.child.gender) : null;
  const selectedCohorts: GrowthCohort[] = selectedCase
    ? (['young', 'old'] as const).filter(cohort => caseHasCohortData(selectedCase, cohort))
    : [];

  return (
    <>
      <PageHeader title={t('learner.title')} description={t('learner.description')} />

      <div className="mb-4">
        <Tabs
          value={view}
          onChange={v => setSearchParams(v === 'table' ? {} : { view: 'charts' })}
          items={[
            { value: 'table', label: t('learner.tabTable'), icon: <Table2 className="size-4" /> },
            { value: 'charts', label: t('learner.tabCharts'), icon: <LineChart className="size-4" /> },
          ]}
        />
      </div>

      {view === 'table' ? (
        <>
          <p className="mb-3 text-sm text-ink-muted">{t('learner.tableHint')}</p>
          <GrowthSummaryTable
            rows={rows}
            mock={false}
            allowTranspose
            onRowClick={row => navigate(`/growth/cases/${row.case_id}?from=growth`)}
          />
        </>
      ) : (
      <>
      {/* Which case, and boys or girls — frozen at the top so the learner never
          scrolls back up to change them (review of 18 Oct 2026). */}
      <div className="sticky top-[3.75rem] z-20 -mx-5 mb-4 flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-border bg-background/95 px-5 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="min-w-0 flex-1 basis-64 sm:max-w-md">
          <MultiSelect
            label={t('learner.pickCases')}
            value={pickedIds}
            onChange={v => selectCases(v.map(Number))}
            options={typed.map(c => ({
              value: c.child.id,
              label: `${t('learner.caseLabel', { child: c.child.name, mother: c.mother.name })} · ${t('learner.visitCount', { count: c.visits.filter(v => v.weight != null || v.length != null).length })}`,
            }))}
            placeholder={`${t('learner.allCases')} (${typed.length})`}
            selectedLabel={n => t('learner.casesPicked', { count: n })}
            searchPlaceholder={t('learner.searchCases')}
            selectAllLabel={t('learner.pickAll')}
            clearLabel={t('learner.clearPicked')}
            emptyMessage={t('learner.noCaseMatches')}
          />
        </div>
        {selectedCase == null && (
          <div role="group" aria-label={t('learner.typeFilter')} className="flex shrink-0 flex-wrap rounded-lg border border-border bg-surface p-0.5">
            {TYPE_FILTERS.map(f => (
              <button
                key={f}
                type="button"
                aria-pressed={typeFilter === f}
                onClick={() => setTypeFilter(f)}
                className={cn('cursor-pointer rounded-md px-2.5 py-1.5 text-sm font-semibold transition-colors',
                  typeFilter === f ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}
              >
                {t(`learner.types.${f}`)}
              </button>
            ))}
          </div>
        )}
        {selectedCase == null ? (
          <div role="tablist" className="flex shrink-0 rounded-lg border border-border bg-surface p-0.5">
            {(['boys', 'girls'] as const).map(s => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={sexTab === s}
                onClick={() => setSexTab(s)}
                className={cn('cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
                  sexTab === s ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink')}
              >
                {t(`sexTabs.${s}`)} ({counts[s]})
              </button>
            ))}
          </div>
        ) : selectedSex && (
          <span className="shrink-0 rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-ink-muted ring-1 ring-border">
            {t(`sexTabs.${selectedSex}`)}
          </span>
        )}
      </div>

      <div className="mb-4">
        <GrowthLegend />
      </div>

      {/* The whole case — every form visit by visit — on its own page (review of 17 Oct 2026). */}
      {selectedCase && (
        <Link
          to={`/growth/cases/${selectedCase.child.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
        >
          <span>
            <span className="block font-semibold text-ink">{t('learner.openCase')}</span>
            <span className="text-ink-muted">{t('learner.openCaseHint')}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-primary-ink" />
        </Link>
      )}

      {selectedCase ? (
        selectedSex == null ? (
          <EmptyState
            icon={<Activity className="size-8" />}
            title={selectedCase.child.name}
            description={t('learner.noGender')}
          />
        ) : selectedCohorts.length === 0 ? (
          <EmptyState
            icon={<Activity className="size-8" />}
            title={selectedCase.child.name}
            description={t('learner.noVisits')}
          />
        ) : (
          <GrowthChartGrid
            cases={[selectedCase]}
            sex={selectedSex}
            standards={standards}
            cohorts={selectedCohorts}
            onPointClick={setDetailPoint}
          />
        )
      ) : (
        <div className="space-y-4">
          {allCasesForTab.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-8" />}
              title={t('learner.noCasesForSex')}
              description={t('learner.noCasesForSexHint')}
            />
          ) : (
            <GrowthChartGrid
              key={`${sexTab}-${pickedIds.join(',')}-${typeFilter}`}
              cases={allCasesForTab}
              sex={sexTab}
              standards={standards}
              onPointClick={setDetailPoint}
            />
          )}
        </div>
      )}

      </>
      )}

      <VisitDetailModal
        point={detailPoint}
        onClose={() => setDetailPoint(null)}
        fetchResponse={fetchResponse}
      />
    </>
  );
};

export default GrowthChartsPage;
