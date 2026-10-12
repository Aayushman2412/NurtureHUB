/**
 * Results → Insights: the test results of a whole project, for managers.
 *
 * Several pages behind one switcher:
 *   * Overview — the whole project in one briefing;
 *   * one page per test (Formative test, Screening test, …) — that test alone;
 *   * tests compared (Formative vs Screening) — the same learners on both,
 *     split by cadre, block, experience and the rest.
 *
 * This shell owns what the pages share: the tests that were actually written,
 * the ways to split learners, the question-by-question numbers (fetched once),
 * and the "focus" — a group the reader clicked, which follows them from page
 * to page ("ASHAs only" stays on when they open the Screening test).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, ClipboardCheck, LayoutDashboard } from 'lucide-react';
import client from '../../api/client';
import { CHART_SERIES } from '../../utils/brandColors';
import { ActiveFilterBar, SplitFilterRow, SubNav, type GroupMode } from './InsightParts';
import OverviewInsights from './OverviewInsights';
import TestInsights from './TestInsights';
import CompareTests from './CompareTests';
import {
  NOT_RECORDED, activeTests, groupOf, usefulDimensions,
  type DimensionKey, type ResultsData, type TestMeta, type TestQuestions,
} from '../../lib/resultsInsights';
import type { DimensionFilters, InsightCtx } from './types';

const VIEW_KEY = 'nh_insights_view';

function readView(): string {
  try {
    return localStorage.getItem(VIEW_KEY) || 'overview';
  } catch {
    return 'overview';
  }
}

const ResultsInsights: React.FC<{ data: ResultsData }> = ({ data }) => {
  const { t } = useTranslation('resultsInsights');

  const labelFor = (test: TestMeta) =>
    test.test_type === 'formative' ? t('testName.formative')
      : test.test_type === 'screening' ? t('testName.screening')
        : test.title;
  const tests = useMemo(() => activeTests(data, labelFor), [data, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const dims = useMemo(() => usefulDimensions(data.users), [data.users]);

  const [view, setViewState] = useState<string>(readView);
  const [dim, setDim] = useState<DimensionKey>(dims.includes('cadre') ? 'cadre' : dims[0] ?? 'cadre');
  const [filters, setFilters] = useState<DimensionFilters>({});
  const [mode, setMode] = useState<GroupMode>('split');
  const [questions, setQuestions] = useState<Record<number, TestQuestions>>({});
  const [questionsLoaded, setQuestionsLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    client.get(`/api/admin/results/questions?district=${encodeURIComponent(data.district)}`)
      .then(res => {
        if (!alive) return;
        const byTest: Record<number, TestQuestions> = {};
        for (const tq of (res.data?.tests ?? []) as TestQuestions[]) byTest[tq.test_id] = tq;
        setQuestions(byTest);
      })
      .catch(() => { /* the question section says it is not available */ })
      .finally(() => { if (alive) setQuestionsLoaded(true); });
    return () => { alive = false; };
  }, [data.district]);

  const setView = (next: string) => {
    setViewState(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* not remembered, still works */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const groupLabel = (g: string, d: DimensionKey = dim): string => {
    if (g === NOT_RECORDED) return t('notRecorded');
    if (d === 'ageGroup') return t(`age.${g}`, { defaultValue: g });
    if (d === 'internet') return t(`internet.${g}`, { defaultValue: g });
    if (d === 'priorTraining') return t(`priorTraining.${g}`, { defaultValue: g });
    return g;
  };

  // Each learner's group on every dimension, worked out once per payload: every
  // filter and split below reads this table instead of re-deriving groups
  // learner by learner on each click (what made filtering crawl on a big cohort).
  const groupTable = useMemo(() => {
    const table = new Map<number, Partial<Record<DimensionKey, string>>>();
    for (const u of data.users) {
      const row: Partial<Record<DimensionKey, string>> = {};
      for (const d of dims) row[d] = groupOf(u, d) ?? NOT_RECORDED;
      table.set(u.user_id, row);
    }
    return table;
  }, [data.users, dims]);

  const keep = (except?: DimensionKey) => {
    const entries = (Object.entries(filters) as [DimensionKey, string[]][])
      .filter(([d, v]) => d !== except && v && v.length > 0)
      .map(([d, v]) => [d, new Set(v)] as const);
    if (entries.length === 0) return data.users;
    return data.users.filter(u => {
      const row = groupTable.get(u.user_id) ?? {};
      return entries.every(([d, picked]) => picked.has(row[d] ?? NOT_RECORDED));
    });
  };

  const users = useMemo(() => keep(), [data.users, filters, groupTable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Split by `dim` over everyone the OTHER filters keep, so the reader sees
  // all of `dim`'s groups with the picked ones highlighted.
  const compareBase = useMemo(() => keep(dim), [data.users, filters, dim, groupTable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Functional, so ticks in quick succession build on each other.
  const setFilterValues = (d: DimensionKey, values: string[] | ((current: string[]) => string[])) => {
    setFilters(prev => {
      const next = { ...prev };
      const list = typeof values === 'function' ? values(prev[d] ?? []) : values;
      if (list.length === 0) delete next[d];
      else next[d] = list;
      return next;
    });
  };

  // Clicking a group in a chart or table adds it to (or drops it from) the
  // groups kept for the current dimension.
  const toggleFocus = (group: string) =>
    setFilterValues(dim, current => (current.includes(group) ? current.filter(g => g !== group) : [...current, group]));

  // The tick-list for Filter by: each group of a dimension and how many
  // learners it holds among those the other filters keep.
  const choices = (d: DimensionKey) => {
    const counts = new Map<string, number>();
    for (const u of keep(d)) {
      const g = groupTable.get(u.user_id)?.[d] ?? NOT_RECORDED;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    for (const g of filters[d] ?? []) if (!counts.has(g)) counts.set(g, 0);
    return [...counts.entries()]
      .sort((a, b) => (a[0] === NOT_RECORDED ? 1 : b[0] === NOT_RECORDED ? -1 : b[1] - a[1] || a[0].localeCompare(b[0])))
      .map(([value, n]) => ({ value, label: groupLabel(value, d), n }));
  };

  const clearFilter = (dimension?: DimensionKey) => {
    if (!dimension) {
      setFilters({});
    } else {
      setFilters(prev => {
        const next = { ...prev };
        delete next[dimension];
        return next;
      });
    }
  };

  const activeGroups = filters[dim] ?? [];
  const ctx: InsightCtx = {
    data, tests, dims, dim, setDim, users,
    compareBase,
    filters,
    activeGroup: activeGroups.length === 1 ? activeGroups[0] : null,
    activeGroups,
    toggleFocus,
    clearFilter,
    groupLabel,
    colorOf: i => CHART_SERIES[i % CHART_SERIES.length],
    questions, questionsLoaded,
    openView: setView,
  };

  // Pages that exist for this project. A remembered page that no longer
  // exists (another project, a test with no papers yet) falls back to Overview.
  const pages = [
    { key: 'overview', label: t('nav.overview'), icon: <LayoutDashboard /> },
    ...tests.map(test => ({ key: `test:${test.id}`, label: test.label, icon: <ClipboardCheck /> })),
    ...(tests.length >= 2
      ? [{ key: 'compare', label: t('nav.compare', { a: tests[0].label, b: tests[tests.length - 1].label }), icon: <ArrowRightLeft /> }]
      : []),
  ];
  const current = pages.some(p => p.key === view) ? view : 'overview';
  const currentTest = current.startsWith('test:') ? tests.find(x => `test:${x.id}` === current) : undefined;

  return (
    <div className="space-y-5">
      {/* Frozen at the top while the page scrolls: which page, how learners
          are split, and any group filter in force — every chart below reads
          them, so they stay in sight. Solid, not frosted: a blur behind a
          sticky bar repaints the whole page on every scroll, which crawls on
          a district-office laptop that is also screen-sharing. */}
      <div className="space-y-2.5 rounded-2xl border border-border bg-surface p-2 shadow-(--shadow-card) sm:sticky sm:top-[3.75rem] sm:z-20 lg:top-2">
        <SubNav items={pages} value={current} onChange={setView} label={t('nav.label')} />
        {dims.length > 0 && (
          <div className="space-y-2 px-1.5 pb-1">
            <SplitFilterRow
              mode={mode}
              onMode={setMode}
              items={dims.map(d => ({ key: d, label: t(`dim.${d}`) }))}
              dim={dim}
              onDim={setDim}
              filters={filters}
              choices={choices}
              onFilter={setFilterValues}
            />
            <ActiveFilterBar
              className="mb-0"
              filters={filters}
              groupLabel={groupLabel}
              onClear={clearFilter}
              filteredCount={users.length}
              totalCount={data.users.length}
            />
          </div>
        )}
      </div>

      {current === 'overview' && <OverviewInsights ctx={ctx} />}
      {currentTest && <TestInsights key={currentTest.id} ctx={ctx} test={currentTest} />}
      {current === 'compare' && <CompareTests ctx={ctx} />}
    </div>
  );
};

export default ResultsInsights;
