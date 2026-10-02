/**
 * Results → Insights → Overview: the whole project in one briefing — the
 * headline, the numbers that matter, the learner journey, findings in plain
 * sentences, groups compared on everything at once, a card per test (each
 * opening that test's own page), the videos, and the top performers.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  ArrowDown, ArrowRight, ArrowRightLeft, ArrowUp, ArrowUpDown, Award, BookOpenCheck, CheckCircle2, ClipboardCheck, Download, Filter, GraduationCap,
  Lightbulb, PlayCircle, Search, Sparkles, UserPlus, Users, X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Badge, Button, Card, Input, Pagination } from '../ui';
import { BAND_COLORS, TEST_A_COLOR, TEST_B_COLOR } from '../../utils/brandColors';
import { BarList, Donut, Journey, Ring, StackedBar, type BarRow, type Slice } from './InsightCharts';
import {
  ActiveFilterBar, ChipRow, FindingList, InlineBar, Kpi, KpiRow, RankBadge, ScoreCell, Section, ToneLegend,
} from './InsightParts';
import {
  cohortStats, findings, fmtPct, groupStats, journey, overallScore, pairStats, signed, toneColor,
  topPerformers, videoStats,
  type Finding, type GroupStats,
} from '../../lib/resultsInsights';
import type { InsightCtx } from './types';
import { cn } from '../../utils/cn';

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const OverviewInsights: React.FC<{ ctx: InsightCtx }> = ({ ctx }) => {
  const { t } = useTranslation('resultsInsights');
  const { data, tests, users, compareBase, dims, dim, setDim, filters, activeGroup, toggleFocus, clearFilter, groupLabel, colorOf, openView } = ctx;
  const lastTest = tests[tests.length - 1];
  const [metric, setMetric] = useState<string>(lastTest ? `pass:${lastTest.id}` : 'videos');

  const overall = useMemo(() => cohortStats(users, tests), [users, tests]);
  const groups = useMemo(() => groupStats(compareBase, dim, tests), [compareBase, dim, tests]);
  const videos = useMemo(() => videoStats(data, users), [data, users]);
  const steps = useMemo(() => journey(users, tests), [users, tests]);
  const facts = useMemo(
    () => findings(users, tests, dim, groupStats(users, dim, tests), videos, g => groupLabel(g)),
    [users, tests, dim, videos], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pair = useMemo(
    () => (tests.length >= 2 ? pairStats(users, tests[0], tests[tests.length - 1]) : null), [users, tests],
  );

  // ── Top performers (Leaderboard) with Top-K, Search, Filter, Sort, Pagination ──
  const [topK, setTopK] = useState<number | 'all'>(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [f2fFilter, setF2fFilter] = useState<'all' | 'selected' | 'not_selected'>('all');
  const [sortCol, setSortCol] = useState<string>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const allRanked = useMemo(() => topPerformers(users, tests, users.length), [users, tests]);
  const rankedLearners = useMemo(() => {
    return allRanked.map((u, i) => ({
      user: u,
      rank: i + 1,
      avgScore: overallScore(u, tests) ?? 0,
    }));
  }, [allRanked, tests]);

  const topKLearners = useMemo(() => {
    if (topK === 'all') return rankedLearners;
    return rankedLearners.slice(0, topK);
  }, [rankedLearners, topK]);

  const filteredLearners = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return topKLearners.filter(({ user }) => {
      if (f2fFilter === 'selected' && !user.face_to_face.selected) return false;
      if (f2fFilter === 'not_selected' && user.face_to_face.selected) return false;
      if (q) {
        const name = (user.name ?? '').toLowerCase();
        const email = (user.email ?? '').toLowerCase();
        const cadre = (user.profile?.cadre ?? '').toLowerCase();
        const block = (user.profile?.block ?? '').toLowerCase();
        if (!name.includes(q) && !email.includes(q) && !cadre.includes(q) && !block.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [topKLearners, f2fFilter, searchQuery]);

  const sortedLearners = useMemo(() => {
    const list = [...filteredLearners];
    list.sort((a, b) => {
      let diff = 0;
      if (sortCol === 'rank') {
        diff = a.rank - b.rank;
      } else if (sortCol === 'name') {
        diff = a.user.name.localeCompare(b.user.name);
      } else if (sortCol === 'cadre') {
        diff = (a.user.profile?.cadre ?? '').localeCompare(b.user.profile?.cadre ?? '');
      } else if (sortCol === 'block') {
        diff = (a.user.profile?.block ?? '').localeCompare(b.user.profile?.block ?? '');
      } else if (sortCol.startsWith('test:')) {
        const testId = sortCol.slice(5);
        const scoreA = a.user.tests[testId]?.best_score ?? -1;
        const scoreB = b.user.tests[testId]?.best_score ?? -1;
        diff = scoreA - scoreB;
      } else if (sortCol === 'average') {
        diff = a.avgScore - b.avgScore;
      } else if (sortCol === 'f2f') {
        diff = Number(a.user.face_to_face.selected) - Number(b.user.face_to_face.selected);
      }
      return sortDir === 'asc' ? diff : -diff;
    });
    return list;
  }, [filteredLearners, sortCol, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [topK, searchQuery, f2fFilter, sortCol, sortDir]);

  const paginatedLearners = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedLearners.slice(start, start + PAGE_SIZE);
  }, [sortedLearners, page]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      if (col === 'average' || col.startsWith('test:') || col === 'f2f') {
        setSortDir('desc');
      } else {
        setSortDir('asc');
      }
    }
  };

  const renderSortHeader = (col: string, label: string, align: 'left' | 'center' = 'left', extraClass?: string) => {
    const active = sortCol === col;
    return (
      <th
        key={col}
        onClick={() => handleSort(col)}
        className={cn(
          'cursor-pointer select-none pb-2 transition-colors hover:text-ink',
          align === 'center' ? 'text-center' : 'text-left',
          active && 'text-primary font-bold',
          extraClass,
        )}
      >
        <div className={cn('inline-flex items-center gap-1', align === 'center' && 'justify-center')}>
          <span>{label}</span>
          {active ? (
            sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
          ) : (
            <ArrowUpDown className="size-3 opacity-30" />
          )}
        </div>
      </th>
    );
  };

  const findingText = (f: Finding) =>
    t(`finding.${f.key}`, { ...f.params, dimName: t(`dimSingular.${String(f.params.dim ?? dim)}`) });

  // ── Compare: the measure shown per group ──
  const base = cohortStats(compareBase, tests);
  const measures: { key: string; label: string; value: (g: GroupStats) => number | null; overall: number | null }[] = [
    ...tests.flatMap(test => [
      { key: `pass:${test.id}`, label: t('measure.pass', { test: test.label }),
        value: (g: GroupStats) => (g.tests[test.id]?.wrote ? g.tests[test.id].passRate : null),
        overall: base.tests[test.id]?.passRate ?? null },
      { key: `score:${test.id}`, label: t('measure.score', { test: test.label }),
        value: (g: GroupStats) => (g.tests[test.id]?.wrote ? g.tests[test.id].avgScore : null),
        overall: base.tests[test.id]?.avgScore ?? null },
    ]),
    { key: 'videos', label: t('measure.videos'), value: g => (g.n ? (g.finishedVideos / g.n) * 100 : null),
      overall: base.n ? (base.finishedVideos / base.n) * 100 : null },
    { key: 'quiz', label: t('measure.quiz'), value: g => g.quizAccuracy || null,
      overall: base.quizAccuracy || null },
    { key: 'selected', label: t('measure.selected'), value: g => (g.n ? (g.selected / g.n) * 100 : null),
      overall: base.n ? (base.selected / base.n) * 100 : null },
  ];
  const measure = measures.find(m => m.key === metric) ?? measures[0];
  const barRows: BarRow[] = groups
    .map(g => ({ g, v: measure.value(g) }))
    .filter(x => x.v !== null)
    .sort((a, b) => (b.v as number) - (a.v as number))
    .map(({ g, v }) => ({
      key: g.group, label: groupLabel(g.group), value: v as number, display: fmtPct(v as number),
      sub: t('compare.ofN', { n: g.n }),
    }));

  const whoSlices: Slice[] = groups.map((g, i) => ({ key: g.group, label: groupLabel(g.group), value: g.n, color: colorOf(i) }));
  const selectedSlices: Slice[] = groups
    .map((g, i) => ({ key: g.group, label: groupLabel(g.group), value: g.selected, color: colorOf(i) }))
    .filter(s => s.value > 0);

  // ── Excel: the whole briefing, one sheet per way of splitting ──
  const downloadSummary = () => {
    const wb = XLSX.utils.book_new();
    const all = cohortStats(data.users, tests);
    const overview: (string | number)[][] = [
      [t('excel.project'), data.district_name],
      [t('excel.learners'), all.n],
      [t('kpi.finishedVideos'), all.finishedVideos],
      ...tests.flatMap(test => [
        [t('excel.wrote', { test: test.label }), all.tests[test.id].wrote],
        [t('excel.passed', { test: test.label }), all.tests[test.id].passed],
        [t('excel.passRate', { test: test.label }), Math.round(all.tests[test.id].passRate)],
        [t('excel.avgScore', { test: test.label }), Math.round(all.tests[test.id].avgScore)],
      ]),
      [t('kpi.selected'), all.selected],
      [],
      [t('findings.title')],
      ...findings(data.users, tests, 'cadre', groupStats(data.users, 'cadre', tests), videoStats(data, data.users),
        g => groupLabel(g, 'cadre')).map(f => [findingText(f)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overview), t('excel.overviewSheet').slice(0, 31));
    for (const d of dims) {
      const header = [
        t(`dim.${d}`), t('excel.learners'), t('scorecard.videos'), t('scorecard.quiz'),
        ...tests.flatMap(test => [t('scorecard.avg', { test: test.label }), t('scorecard.passed', { test: test.label })]),
        t('scorecard.selected'),
      ];
      const rows = groupStats(data.users, d, tests).map(g => [
        groupLabel(g.group, d), g.n,
        Math.round(g.n ? (g.finishedVideos / g.n) * 100 : 0), Math.round(g.quizAccuracy),
        ...tests.flatMap(test => [Math.round(g.tests[test.id].avgScore), Math.round(g.tests[test.id].passRate)]),
        Math.round(g.n ? (g.selected / g.n) * 100 : 0),
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), t(`dim.${d}`).replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
    }
    XLSX.writeFile(wb, `results_insights_${data.district}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Headline */}
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-r from-coral-50 via-surface to-sage-50 p-5 sm:p-6 dark:from-coral-500/10 dark:via-surface dark:to-sage-500/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary-ink">
                <Sparkles className="size-3.5" /> {t('hero.eyebrow')}
              </div>
              <h2 className="font-display text-xl font-extrabold text-ink sm:text-2xl">
                {lastTest
                  ? t('hero.sentence', {
                    project: data.district_name, n: overall.n, passed: overall.tests[lastTest.id].passed,
                    pct: Math.round(pctOf(overall.tests[lastTest.id].passed, overall.n)), test: lastTest.label, selected: overall.selected,
                  })
                  : t('hero.noTests', { project: data.district_name, n: overall.n })}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{t('hero.hint')}</p>
              {Object.keys(filters).length > 0 && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  <Filter className="size-3 text-amber-700 dark:text-amber-400" />
                  <span>{t('focus.filteredNotice', { count: users.length, total: data.users.length })}</span>
                  <button
                    type="button"
                    onClick={() => clearFilter()}
                    className="font-semibold underline hover:text-ink cursor-pointer"
                  >
                    {t('focus.clear')}
                  </button>
                </div>
              )}
            </div>
            <Button variant="outline" iconLeft={<Download className="size-4" />} onClick={downloadSummary}>
              {t('download')}
            </Button>
          </div>
        </div>
      </Card>

      {/* The numbers that matter */}
      <KpiRow count={3 + tests.length}>
        <Kpi
          visual={(
            <span className="flex size-[76px] items-center justify-center rounded-full bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300">
              <Users className="size-8" />
            </span>
          )}
          label={t('kpi.learners')}
          value={<span className="font-display text-2xl font-extrabold">{overall.n.toLocaleString()}</span>}
        />
        <Kpi
          visual={<Ring value={pctOf(overall.finishedVideos, overall.n)} />}
          label={t('kpi.finishedVideos')}
          value={<Trans t={t} i18nKey="kpi.nOfM" values={{ n: overall.finishedVideos, m: overall.n }} components={{ b: <strong /> }} />}
        />
        {tests.map(test => {
          const s = overall.tests[test.id];
          return (
            <Kpi
              key={test.id}
              visual={<Ring value={s.passRate} />}
              label={t('kpi.passed', { test: test.label })}
              value={<Trans t={t} i18nKey="kpi.nOfWrote" values={{ n: s.passed, m: s.wrote }} components={{ b: <strong /> }} />}
              note={t('kpi.avgScore', { score: Math.round(s.avgScore) })}
            />
          );
        })}
        <Kpi
          visual={<Ring value={pctOf(overall.selected, overall.n)} color="var(--color-coral-500)" />}
          label={t('kpi.selected')}
          value={<Trans t={t} i18nKey="kpi.nOfM" values={{ n: overall.selected, m: overall.n }} components={{ b: <strong /> }} />}
        />
      </KpiRow>

      {/* Journey + findings */}
      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Section icon={<GraduationCap />} title={t('journey.title')} subtitle={t('journey.subtitle')}>
          <Journey
            total={overall.n}
            steps={steps.map(s => ({
              key: `${s.key}:${s.params?.test ?? ''}`,
              label: t(`journey.${s.key}`, s.params),
              count: s.count,
              icon: s.key === 'registered' ? <UserPlus /> : s.key === 'finishedVideos' ? <PlayCircle />
                : s.key === 'wroteTest' ? <ClipboardCheck /> : s.key === 'passedTest' ? <CheckCircle2 /> : <Award />,
            }))}
            ofLabel={p => t('journey.ofAll', { pct: p })}
            lostLabel={n => t('journey.lost', { n })}
          />
        </Section>
        <Section icon={<Lightbulb />} title={t('findings.title')} subtitle={t('findings.subtitle')}>
          <FindingList findings={facts} text={findingText} empty={t('findings.none')} />
        </Section>
      </div>

      {/* Each test, in brief — with the way into its own page */}
      {tests.length > 0 ? (
        <div className={cn('grid gap-6', tests.length > 1 && 'xl:grid-cols-2')}>
          {tests.map(test => {
            const s = overall.tests[test.id];
            const excellentFrom = Math.max(85, test.passMark);
            return (
              <Section
                key={test.id}
                icon={<ClipboardCheck />}
                title={test.label}
                subtitle={t('test.subtitle', { title: test.title, mark: test.passMark })}
                actions={(
                  <Button size="sm" variant="outline" iconLeft={<ArrowRight className="size-4" />} onClick={() => openView(`test:${test.id}`)}>
                    {t('nav.openTest', { test: test.label })}
                  </Button>
                )}
              >
                <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                  <div className="flex shrink-0 flex-col items-center text-center">
                    <Ring value={s.passRate} size={104} stroke={11} />
                    <div className="mt-2 text-xs font-semibold text-ink">
                      {t('kpi.passed', { test: test.label })}
                    </div>
                    <div className="text-xs text-ink-muted">
                      <Trans t={t} i18nKey="kpi.nOfWrote" values={{ n: s.passed, m: s.wrote }} components={{ b: <strong /> }} />
                    </div>
                    <div className="text-[0.7rem] text-ink-faint">
                      {t('kpi.avgScore', { score: Math.round(s.avgScore) })}
                    </div>
                  </div>
                  <dl className="grid w-full grid-cols-3 gap-2 text-center sm:flex-1 sm:gap-3">
                    {([
                      [t('test.wrote'), String(s.wrote), undefined],
                      [t('test.passed'), String(s.passed), BAND_COLORS.excellent],
                      [t('test.avgScore'), fmtPct(s.avgScore), toneColor(s.avgScore)],
                    ] as [string, string, string | undefined][]).map(([label, value, color]) => (
                      <div key={label} className="min-w-0 rounded-xl bg-surface-sunken px-2 py-3">
                        <dt className="text-[0.7rem] leading-tight text-ink-muted sm:text-xs">{label}</dt>
                        <dd className="font-display text-xl font-extrabold text-ink sm:text-2xl" style={color ? { color } : undefined}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <h4 className="mb-2 text-sm font-semibold text-ink">{t('test.bandsTitle')}</h4>
                <StackedBar parts={[
                  { key: 'ex', label: t('test.bandExcellent', { from: excellentFrom }), value: s.bands.excellent, color: BAND_COLORS.excellent },
                  { key: 'ok', label: t('test.bandPassed', { from: test.passMark, to: excellentFrom - 1 }), value: s.bands.passed, color: BAND_COLORS.passed },
                  { key: 'near', label: t('test.bandNear', { from: Math.max(0, test.passMark - 20), to: test.passMark - 1 }), value: s.bands.nearMiss, color: BAND_COLORS.nearMiss },
                  { key: 'low', label: t('test.bandSupport', { below: Math.max(0, test.passMark - 20) }), value: s.bands.support, color: BAND_COLORS.support },
                ]} />
              </Section>
            );
          })}
        </div>
      ) : (
        <Card className="p-6 text-sm text-ink-muted">{t('noTests')}</Card>
      )}

      {pair && pair.n > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300">
              <ArrowRightLeft className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="font-display text-lg font-bold text-ink">
                {t('nav.compare', { a: tests[0].label, b: tests[tests.length - 1].label })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <span className="font-bold tabular-nums" style={{ color: TEST_A_COLOR }}>{fmtPct(pair.avgA)}</span>
                <ArrowRight className="size-3.5" />
                <span className="font-bold tabular-nums" style={{ color: TEST_B_COLOR }}>{fmtPct(pair.avgB)}</span>
                <span>{t('nav.compareTeaser', { n: pair.n, change: signed(pair.change) })}</span>
              </div>
            </div>
          </div>
          <Button variant="outline" iconLeft={<ArrowRight className="size-4" />} onClick={() => openView('compare')}>
            {t('nav.openCompare')}
          </Button>
        </Card>
      )}

      {/* Compare groups, on everything */}
      {dims.length > 0 && (
        <Section icon={<Users />} title={t('compare.title')} subtitle={t('compare.subtitle')}>
          <ActiveFilterBar
            filters={filters}
            groupLabel={groupLabel}
            onClear={clearFilter}
            filteredCount={users.length}
            totalCount={data.users.length}
          />
          <ChipRow
            label={t('compare.splitBy')}
            items={dims.map(d => ({ key: d, label: t(`dim.${d}`) }))}
            value={dim}
            onChange={k => setDim(k as typeof dim)}
          />
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <div>
              <h4 className="mb-3 text-sm font-semibold text-ink">{t('compare.who', { dim: t(`dim.${dim}`) })}</h4>
              <Donut
                slices={whoSlices}
                centerValue={compareBase.length}
                centerLabel={t('compare.learners')}
                activeKey={activeGroup}
                onSelect={toggleFocus}
                selectHint={t('compare.clickHint')}
              />
            </div>
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{t('compare.show')}</span>
                <select
                  value={measure.key}
                  onChange={e => setMetric(e.target.value)}
                  className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
                >
                  {measures.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <BarList
                rows={barRows}
                reference={measure.overall !== null ? { value: measure.overall, label: t('compare.average', { value: fmtPct(measure.overall) }) } : undefined}
                activeKey={activeGroup}
                onSelect={toggleFocus}
                selectHint={t('compare.clickHint')}
              />
            </div>
          </div>

          <div className="mt-8">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink">{t('scorecard.title', { dim: t(`dim.${dim}`) })}</h4>
              <ToneLegend good={t('scorecard.good')} ok={t('scorecard.ok')} low={t('scorecard.low')} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-2.5 text-left">{t(`dim.${dim}`)}</th>
                    <th className="px-3 py-2.5 text-center">{t('scorecard.learners')}</th>
                    <th className="px-3 py-2.5 text-center">{t('scorecard.videos')}</th>
                    <th className="px-3 py-2.5 text-center">{t('scorecard.quiz')}</th>
                    {tests.map(test => (
                      <React.Fragment key={test.id}>
                        <th className="px-3 py-2.5 text-center">{t('scorecard.avg', { test: test.label })}</th>
                        <th className="px-3 py-2.5 text-center">{t('scorecard.passed', { test: test.label })}</th>
                      </React.Fragment>
                    ))}
                    <th className="px-3 py-2.5 text-center">{t('scorecard.selected')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => (
                    <tr
                      key={g.group}
                      onClick={() => toggleFocus(g.group)}
                      title={t('compare.clickHint')}
                      className={cn(
                        'cursor-pointer border-t border-border transition-colors hover:bg-surface-sunken',
                        activeGroup === g.group && 'bg-surface-sunken',
                        activeGroup && activeGroup !== g.group && 'opacity-50',
                      )}
                    >
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2 font-semibold text-ink">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(i) }} />
                          {groupLabel(g.group)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums text-ink">{g.n}</td>
                      <ScoreCell value={g.n ? (g.finishedVideos / g.n) * 100 : null} />
                      <ScoreCell value={g.quizAccuracy || null} />
                      {tests.map(test => {
                        const s = g.tests[test.id];
                        return (
                          <React.Fragment key={test.id}>
                            <ScoreCell value={s.wrote ? s.avgScore : null} />
                            <ScoreCell value={s.wrote ? s.passRate : null} sub={s.wrote ? t('scorecard.nOfM', { n: s.passed, m: s.wrote }) : undefined} />
                          </React.Fragment>
                        );
                      })}
                      <ScoreCell value={g.n ? (g.selected / g.n) * 100 : null} sub={t('scorecard.nOfM', { n: g.selected, m: g.n })} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedSlices.length > 0 && (
            <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
              <div>
                <h4 className="mb-3 text-sm font-semibold text-ink">{t('compare.selectedWho', { dim: t(`dim.${dim}`) })}</h4>
                <Donut
                  slices={selectedSlices}
                  centerValue={selectedSlices.reduce((a, s) => a + s.value, 0)}
                  centerLabel={t('compare.selectedCenter')}
                  activeKey={activeGroup}
                  onSelect={toggleFocus}
                  selectHint={t('compare.clickHint')}
                />
              </div>
              <div className="self-center rounded-xl bg-surface-sunken p-4 text-sm leading-relaxed text-ink-muted">
                <Lightbulb className="mb-2 size-5 text-primary-ink" />
                {t('compare.selectedExplain')}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Videos & quizzes */}
      {videos.length > 0 && (
        <Section icon={<BookOpenCheck />} title={t('videos.title')} subtitle={t('videos.subtitle')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="pb-2 text-left">{t('videos.video')}</th>
                  <th className="w-[34%] pb-2 text-left">{t('videos.finished')}</th>
                  <th className="w-[34%] pb-2 text-left">{t('videos.quizCorrect')}</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v, i) => (
                  <tr key={v.id} className="border-t border-border">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-ink">{i + 1}. {v.title}</div>
                      {v.phase && <div className="text-xs text-ink-faint">{v.phase}</div>}
                    </td>
                    <td className="py-2.5 pr-4"><InlineBar value={v.finishedPct} /></td>
                    <td className="py-2.5">
                      {v.quizCorrectPct === null
                        ? <span className="text-xs text-ink-faint">{v.hasQuiz ? t('videos.noAnswers') : t('videos.noQuiz')}</span>
                        : <InlineBar value={v.quizCorrectPct} note={t('videos.answeredBy', { n: v.quizAnswered })} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Top performers (Leaderboard) */}
      {rankedLearners.length > 0 && (
        <Section
          icon={<Award />}
          title={topK === 'all' ? t('top.allTitle') : t('top.titleK', { count: topK })}
          subtitle={t('top.subtitle')}
        >
          {/* Controls: Search, F2F filter, Top K selector */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <Input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('top.searchPlaceholder')}
                className="h-9 pl-9 pr-8 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="font-semibold">{t('top.f2fLabel')}</span>
                <select
                  value={f2fFilter}
                  onChange={e => setF2fFilter(e.target.value as typeof f2fFilter)}
                  className="cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-primary focus:outline-none"
                >
                  <option value="all">{t('top.f2fAll')}</option>
                  <option value="selected">{t('top.f2fSelected')}</option>
                  <option value="not_selected">{t('top.f2fNotSelected')}</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="font-semibold">{t('top.showLabel')}</span>
                <select
                  value={topK}
                  onChange={e => setTopK(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink focus:border-primary focus:outline-none"
                >
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                  <option value={20}>Top 20</option>
                  <option value={50}>Top 50</option>
                  <option value="all">{t('top.showAll')}</option>
                </select>
              </div>
            </div>
          </div>

          {sortedLearners.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-muted">
              {t('top.noPerformers')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    {renderSortHeader('rank', '#', 'left', 'w-12')}
                    {renderSortHeader('name', t('top.learner'), 'left')}
                    {renderSortHeader('cadre', t('dim.cadre'), 'left')}
                    {renderSortHeader('block', t('dim.block'), 'left')}
                    {tests.map(test => renderSortHeader(`test:${test.id}`, test.label, 'center'))}
                    {renderSortHeader('average', t('top.average'), 'center')}
                    {renderSortHeader('f2f', t('top.faceToFace'), 'center')}
                  </tr>
                </thead>
                <tbody>
                  {paginatedLearners.map(({ user: u, rank, avgScore }) => (
                    <tr key={u.user_id} className="border-t border-border transition-colors hover:bg-surface-sunken">
                      <td className="py-2"><RankBadge rank={rank} /></td>
                      <td className="py-2">
                        <div className="font-semibold text-ink">{u.name}</div>
                        <div className="text-xs text-ink-faint">{u.email}</div>
                      </td>
                      <td className="py-2 text-ink-muted">{u.profile?.cadre ?? '—'}</td>
                      <td className="py-2 text-ink-muted">{u.profile?.block ?? '—'}</td>
                      {tests.map(test => {
                        const r = u.tests[String(test.id)];
                        return (
                          <td key={test.id} className="py-2 text-center font-semibold tabular-nums"
                            style={{ color: r?.attempts_count ? toneColor(r.best_score ?? 0) : undefined }}>
                            {r?.attempts_count ? fmtPct(r.best_score ?? 0) : '—'}
                          </td>
                        );
                      })}
                      <td className="py-2 text-center font-display font-extrabold tabular-nums text-ink">
                        {fmtPct(avgScore)}
                      </td>
                      <td className="py-2 text-center">
                        {u.face_to_face.selected
                          ? <Badge variant="coral" size="sm">{t('top.selected')}</Badge>
                          : <span className="text-ink-faint">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sortedLearners.length > PAGE_SIZE && (
            <div className="mt-4 border-t border-border pt-3">
              <Pagination
                currentPage={page}
                totalItems={sortedLearners.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                itemLabel={t('kpi.learners')}
              />
            </div>
          )}
        </Section>
      )}
    </div>
  );
};

export default OverviewInsights;
