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
import { ArrowRightLeft, ClipboardCheck, Filter, LayoutDashboard, X } from 'lucide-react';
import client from '../../api/client';
import { Button } from '../ui';
import { CHART_SERIES } from '../../utils/brandColors';
import { SubNav } from './InsightParts';
import OverviewInsights from './OverviewInsights';
import TestInsights from './TestInsights';
import CompareTests from './CompareTests';
import {
  NOT_RECORDED, activeTests, groupOf, usefulDimensions,
  type DimensionKey, type ResultsData, type TestMeta, type TestQuestions,
} from '../../lib/resultsInsights';
import type { InsightCtx } from './types';

interface Focus {
  dim: DimensionKey;
  group: string;
}

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
  const [focus, setFocus] = useState<Focus | null>(null);
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

  const users = useMemo(
    () => (focus ? data.users.filter(u => (groupOf(u, focus.dim) ?? NOT_RECORDED) === focus.group) : data.users),
    [data.users, focus],
  );

  const ctx: InsightCtx = {
    data, tests, dims, dim, setDim, users,
    compareBase: focus && focus.dim !== dim ? users : data.users,
    activeGroup: focus && focus.dim === dim ? focus.group : null,
    toggleFocus: group => setFocus(f => (f && f.dim === dim && f.group === group ? null : { dim, group })),
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
      <SubNav items={pages} value={current} onChange={setView} label={t('nav.label')} />

      {focus && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <Filter className="size-4 text-amber-700 dark:text-amber-500" />
          <span className="text-ink">
            {t('focus.showing', { group: groupLabel(focus.group, focus.dim), dimName: t(`dimSingular.${focus.dim}`), n: users.length })}
          </span>
          <Button size="sm" variant="outline" iconLeft={<X className="size-3.5" />} onClick={() => setFocus(null)}>
            {t('focus.clear')}
          </Button>
        </div>
      )}

      {current === 'overview' && <OverviewInsights ctx={ctx} />}
      {currentTest && <TestInsights key={currentTest.id} ctx={ctx} test={currentTest} />}
      {current === 'compare' && <CompareTests ctx={ctx} />}
    </div>
  );
};

export default ResultsInsights;
