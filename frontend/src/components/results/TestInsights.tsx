/**
 * Results → Insights → one test (the Formative test page, the Screening test
 * page, …): everything about a single test on its own — how many wrote and
 * passed, how the scores are spread, which groups did well, which questions
 * people got wrong, and who needs support.
 */
import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Award, ClipboardCheck, Download, Filter, HelpCircle, LifeBuoy, Lightbulb, RotateCcw, Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button, Card } from '../ui';
import { cn } from '../../utils/cn';
import { BAND_COLORS } from '../../utils/brandColors';
import { BarList, Donut, Histogram, Ring, StackedBar, type BarRow, type Slice } from './InsightCharts';
import {
  BigNumber, Chip, CountPicker, FindingList, InlineBar, Kpi, KpiRow, RankBadge, ScoreCell, Section, ToneLegend,
  type CountValue, type RankDir,
} from './InsightParts';
import {
  DIFFICULTY_CUTOFFS, bottomScorers, fmtPct, lowestScorers, questionDifficulty, scoreDistribution, testFindings,
  testGroupStats, testStats, toneColor, topScorers, wrongAnswers,
  type ActiveTest, type Difficulty, type Finding, type TestStats, type UserResultRow,
} from '../../lib/resultsInsights';
import type { InsightCtx } from './types';

type Measure = 'pass' | 'score' | 'firstTry' | 'notTaken';
type QuestionOrder = 'hardest' | 'paper';

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const TestInsights: React.FC<{ ctx: InsightCtx; test: ActiveTest }> = ({ ctx, test }) => {
  const { t } = useTranslation('resultsInsights');
  const { data, users, compareBase, dims, dim, filters, activeGroup, toggleFocus, clearFilter, groupLabel, colorOf } = ctx;
  const [measure, setMeasure] = useState<Measure>('pass');
  const [order, setOrder] = useState<QuestionOrder>('hardest');
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const [topic, setTopic] = useState('');
  const [topN, setTopN] = useState<CountValue>(10);
  const [topDir, setTopDir] = useState<RankDir>('top');
  const [supportN, setSupportN] = useState<CountValue>(10);

  const s = useMemo(() => testStats(users, test), [users, test]);
  const groups = useMemo(() => testGroupStats(compareBase, dim, test), [compareBase, dim, test]);
  const base = useMemo(() => testStats(compareBase, test), [compareBase, test]);
  const questions = ctx.questions[test.id];
  const bars = useMemo(() => scoreDistribution(users, test), [users, test]);
  const facts = useMemo(
    () => testFindings(users, test, dim, g => groupLabel(g), questions),
    [users, test, dim, questions], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const top = useMemo(() => {
    const n = topN === 'all' ? users.length : topN;
    return topDir === 'top' ? topScorers(users, test, n) : bottomScorers(users, test, n);
  }, [users, test, topN, topDir]);
  const support = useMemo(
    () => lowestScorers(users, test, supportN === 'all' ? users.length : supportN), [users, test, supportN],
  );

  const findingText = (f: Finding) =>
    t(`finding.${f.key}`, { ...f.params, dimName: t(`dimSingular.${String(f.params.dim ?? dim)}`) });
  const excellentFrom = Math.max(85, test.passMark);
  const nearFrom = Math.max(0, test.passMark - 20);

  // Lowest band first, as in the histogram above it: red on the left, green on the right.
  const bandParts = (st: TestStats): Slice[] => [
    { key: 'low', label: t('test.bandSupport', { below: nearFrom }), value: st.bands.support, color: BAND_COLORS.support },
    { key: 'near', label: t('test.bandNear', { from: nearFrom, to: test.passMark - 1 }), value: st.bands.nearMiss, color: BAND_COLORS.nearMiss },
    { key: 'ok', label: t('test.bandPassed', { from: test.passMark, to: excellentFrom - 1 }), value: st.bands.passed, color: BAND_COLORS.passed },
    { key: 'ex', label: t('test.bandExcellent', { from: excellentFrom }), value: st.bands.excellent, color: BAND_COLORS.excellent },
  ];

  const notTaken = measure === 'notTaken';
  const measureValue = (st: TestStats): number | null => {
    if (notTaken) return st.registered ? pctOf(st.notTaken, st.registered) : null;
    if (!st.wrote) return null;
    if (measure === 'pass') return st.passRate;
    if (measure === 'score') return st.avgScore;
    return pctOf(st.firstTry, st.wrote);
  };
  const overallValue = measureValue(base);
  const barRows: BarRow[] = groups
    .map(g => ({ g, v: measureValue(g.stats) }))
    .filter(x => x.v !== null)
    .sort((a, b) => (b.v as number) - (a.v as number))
    .map(({ g, v }) => ({
      key: g.group, label: groupLabel(g.group), value: v as number, display: fmtPct(v as number),
      // Not taking the test is the bad outcome: the more, the redder.
      color: notTaken ? toneColor(100 - (v as number)) : undefined,
      sub: notTaken
        ? t('testPage.notTakenOfN', { n: g.stats.notTaken, m: g.stats.registered })
        : t('testPage.wroteOfN', { n: g.stats.wrote }),
    }));
  // The pie: who wrote it — or, when the reader asks, who did NOT.
  const writersSlices: Slice[] = groups
    .map((g, i) => ({ key: g.group, label: groupLabel(g.group), value: notTaken ? g.stats.notTaken : g.stats.wrote, color: colorOf(i) }));

  const topics = useMemo(
    () => [...new Set((questions?.questions ?? []).map(q => q.topic).filter((x): x is string => !!x))].sort(),
    [questions],
  );
  const difficultyCount = useMemo(() => {
    const c: Record<Difficulty, number> = { difficult: 0, medium: 0, easy: 0 };
    for (const q of questions?.questions ?? []) if (q.writers > 0) c[questionDifficulty(q)] += 1;
    return c;
  }, [questions]);
  const questionRows = useMemo(() => {
    let qs = [...(questions?.questions ?? [])];
    if (difficulty !== 'all') qs = qs.filter(q => q.writers > 0 && questionDifficulty(q) === difficulty);
    if (topic) qs = qs.filter(q => q.topic === topic);
    if (order === 'hardest') qs.sort((a, b) => pctOf(a.correct, a.writers) - pctOf(b.correct, b.writers));
    return qs;
  }, [questions, order, difficulty, topic]);

  // ── Excel: this test only ──
  const download = () => {
    const wb = XLSX.utils.book_new();
    const summary: (string | number)[][] = [
      [t('excel.project'), data.district_name],
      [t('testPage.testLabel'), test.title],
      [t('testPage.passMark'), `${test.passMark}%`],
      [t('test.wrote'), s.wrote],
      [t('test.passed'), s.passed],
      [t('excel.passRate', { test: test.label }), Math.round(s.passRate)],
      [t('excel.avgScore', { test: test.label }), Math.round(s.avgScore)],
      [t('test.firstTry'), s.firstTry],
      [t('test.afterRetake'), s.afterRetake],
      [t('test.notPassed'), s.notPassed],
      [],
      [t('findings.title')],
      ...testFindings(data.users, test, 'cadre', g => groupLabel(g, 'cadre'), questions).map(f => [findingText(f)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), t('excel.overviewSheet').slice(0, 31));
    for (const d of dims) {
      const rows = testGroupStats(data.users, d, test).map(g => [
        groupLabel(g.group, d), g.stats.wrote, Math.round(g.stats.avgScore), g.stats.passed,
        Math.round(g.stats.passRate), g.stats.firstTry, g.stats.afterRetake, g.stats.notPassed,
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[
        t(`dim.${d}`), t('test.wrote'), t('test.avgScore'), t('test.passed'), t('testPage.passRatePct'),
        t('test.firstTry'), t('test.afterRetake'), t('test.notPassed'),
      ], ...rows]), t(`dim.${d}`).replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
    }
    if (questions?.questions.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['#', t('questions.question'), t('questions.topic'), t('questions.subtopic'), t('questions.difficulty'),
          t('questions.rightAnswer'), t('questions.correctPct'), t('questions.correctN'), t('questions.wrongAnswers'),
          t('questions.blankPct')],
        ...questions.questions.map(q => [
          q.number, q.text, q.topic ?? '', q.subtopic ?? '',
          q.writers ? t(`questions.level.${questionDifficulty(q)}`) : '',
          `${q.correct_label ?? ''} ${q.correct_text ?? ''}`.trim(),
          Math.round(pctOf(q.correct, q.writers)), q.correct,
          wrongAnswers(q).map(w => `${w.label}: ${Math.round(w.pct)}%`).join(', '),
          Math.round(pctOf(q.unanswered, q.writers)),
        ]),
      ]), t('questions.sheet').slice(0, 31));
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [t('top.learner'), 'Email', t('dim.cadre'), t('dim.block'), t('testPage.bestScore'),
        t('testPage.firstScore'), t('testPage.attempts'), t('test.passed')],
      ...data.users.filter(u => (u.tests[String(test.id)]?.attempts_count ?? 0) > 0).map(u => {
        const r = u.tests[String(test.id)];
        return [u.name, u.email, u.profile?.cadre ?? '', u.profile?.block ?? '', r.best_score ?? 0,
          r.first_score ?? '', r.attempts_count, r.is_passed ? t('testPage.yes') : t('testPage.no')];
      }),
    ]), t('testPage.learnersSheet').slice(0, 31));
    XLSX.writeFile(wb, `results_${data.district}_${test.label.replace(/\s+/g, '_').toLowerCase()}.xlsx`);
  };

  if (s.wrote === 0) {
    return <Card className="p-6 text-sm text-ink-muted">{t('testPage.nobody', { test: test.label })}</Card>;
  }

  return (
    <div className="space-y-6">
      {/* Headline */}
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-r from-coral-50 via-surface to-sage-50 p-5 sm:p-6 dark:from-coral-500/10 dark:via-surface dark:to-sage-500/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary-ink">
                <ClipboardCheck className="size-3.5" /> {test.label}
              </div>
              <h2 className="font-display text-xl font-extrabold text-ink sm:text-2xl">
                {t('testPage.sentence', { passed: s.passed, wrote: s.wrote, pct: Math.round(s.passRate), avg: Math.round(s.avgScore), test: test.label })}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {t('testPage.meta', { title: test.title, mark: test.passMark, n: questions?.questions.length ?? '—', attempts: test.max_attempts ?? '—' })}
              </p>
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
            <Button variant="outline" iconLeft={<Download className="size-4" />} onClick={download}>
              {t('testPage.download', { test: test.label })}
            </Button>
          </div>
        </div>
      </Card>

      {/* Key numbers */}
      <KpiRow count={5}>
        <Kpi
          visual={<Ring value={pctOf(s.wrote, users.length)} />}
          label={t('testPage.kpiWrote')}
          value={<Trans t={t} i18nKey="kpi.nOfM" values={{ n: s.wrote, m: users.length }} components={{ b: <strong /> }} />}
        />
        <Kpi
          visual={<Ring value={s.passRate} />}
          label={t('test.passed')}
          value={<Trans t={t} i18nKey="kpi.nOfWrote" values={{ n: s.passed, m: s.wrote }} components={{ b: <strong /> }} />}
        />
        <Kpi
          visual={<Ring value={s.avgScore} />}
          label={t('test.avgScore')}
          value={t('testPage.passMarkIs', { mark: test.passMark })}
        />
        <Kpi
          visual={<Ring value={pctOf(s.firstTry, s.wrote)} />}
          label={t('test.firstTry')}
          value={<Trans t={t} i18nKey="kpi.nOfWrote" values={{ n: s.firstTry, m: s.wrote }} components={{ b: <strong /> }} />}
        />
        <Kpi
          visual={<BigNumber value={s.afterRetake} icon={<span className="flex flex-col items-center leading-none"><RotateCcw className="mb-1 size-4" />{s.afterRetake}</span>} />}
          label={t('test.afterRetake')}
          value={t('testPage.notPassedN', { n: s.notPassed })}
        />
      </KpiRow>

      {/* Findings + how the scores are spread */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={<Lightbulb />} title={t('findings.title')} subtitle={t('testPage.findingsSubtitle', { test: test.label })}>
          <FindingList findings={facts} text={findingText} empty={t('findings.none')} />
        </Section>
        <Section icon={<ClipboardCheck />} title={t('test.bandsTitle')} subtitle={t('testPage.histSubtitle')}>
          <Histogram
            bars={bars}
            passMark={test.passMark}
            passLabel={t('testPage.passMarkShort', { mark: test.passMark })}
            countLabel={(n, label) => t('testPage.barTitle', { n, label })}
            axisLabel={t('testPage.histAxis')}
          />
          <div className="mt-6">
            <StackedBar parts={bandParts(s)} />
          </div>
          <h4 className="mb-2 mt-5 text-sm font-semibold text-ink">{t('test.attemptsTitle')}</h4>
          <StackedBar parts={[
            { key: 'first', label: t('test.firstTry'), value: s.firstTry, color: BAND_COLORS.excellent },
            { key: 'retake', label: t('test.afterRetake'), value: s.afterRetake, color: '#4F7CAC' },
            { key: 'not', label: t('test.notPassed'), value: s.notPassed, color: BAND_COLORS.support },
          ]} />
        </Section>
      </div>

      {/* Groups compared, on this test */}
      {dims.length > 0 && (
        <Section
          icon={<Users />}
          title={t('testPage.groupsTitle', { test: test.label })}
          subtitle={t('compare.subtitle')}
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <div>
              <h4 className="mb-3 text-base font-semibold text-ink">
                {notTaken ? t('testPage.whoNotTaken', { dim: t(`dim.${dim}`) }) : t('testPage.whoWrote', { dim: t(`dim.${dim}`) })}
              </h4>
              <Donut
                slices={writersSlices}
                centerValue={notTaken ? base.notTaken : base.wrote}
                centerLabel={notTaken ? t('testPage.notTakenIt') : t('testPage.wroteIt')}
                activeKey={activeGroup}
                onSelect={toggleFocus}
                selectHint={t('compare.clickHint')}
              />
            </div>
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{t('compare.show')}</span>
                <select
                  value={measure}
                  onChange={e => setMeasure(e.target.value as Measure)}
                  className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
                >
                  <option value="pass">{t('testPage.measurePass')}</option>
                  <option value="score">{t('testPage.measureScore')}</option>
                  <option value="firstTry">{t('testPage.measureFirstTry')}</option>
                  <option value="notTaken">{t('testPage.measureNotTaken')}</option>
                </select>
              </div>
              <BarList
                rows={barRows}
                reference={overallValue !== null ? { value: overallValue, label: t('compare.average', { value: fmtPct(overallValue) }) } : undefined}
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
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-2.5 text-left">{t(`dim.${dim}`)}</th>
                    <th className="px-3 py-2.5 text-center">{t('test.wrote')}</th>
                    <th className="px-3 py-2.5 text-center">{t('test.avgScore')}</th>
                    <th className="px-3 py-2.5 text-center">{t('test.passed')}</th>
                    <th className="px-3 py-2.5 text-center">{t('test.firstTry')}</th>
                    <th className="px-3 py-2.5 text-center">{t('testPage.retakes')}</th>
                    <th className="w-[22%] px-3 py-2.5 text-left">{t('testPage.spread')}</th>
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
                      <td className="px-3 py-2 text-center font-semibold tabular-nums text-ink">{g.stats.wrote}</td>
                      <ScoreCell value={g.stats.wrote ? g.stats.avgScore : null} />
                      <ScoreCell value={g.stats.wrote ? g.stats.passRate : null}
                        sub={g.stats.wrote ? t('scorecard.nOfM', { n: g.stats.passed, m: g.stats.wrote }) : undefined} />
                      <ScoreCell value={g.stats.wrote ? pctOf(g.stats.firstTry, g.stats.wrote) : null}
                        sub={g.stats.wrote ? t('scorecard.nOfM', { n: g.stats.firstTry, m: g.stats.wrote }) : undefined} />
                      <td className="px-3 py-2 text-center tabular-nums text-ink">{g.stats.afterRetake}</td>
                      <td className="px-3 py-2">
                        {g.stats.wrote > 0 && <StackedBar parts={bandParts(g.stats)} height="h-5" showLegend={false} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
              {bandParts(s).map(p => (
                <span key={p.key} className="inline-flex items-center gap-1.5">
                  <span className="size-3 rounded-full" style={{ background: p.color }} />{p.label}
                </span>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* Question by question */}
      <Section
        icon={<HelpCircle />}
        title={t('questions.title')}
        subtitle={t('questions.subtitle')}
        actions={(
          <div className="flex gap-2">
            {(['hardest', 'paper'] as QuestionOrder[]).map(o => (
              <Button key={o} size="sm" variant={order === o ? 'primary' : 'outline'} onClick={() => setOrder(o)}>
                {t(`questions.order.${o}`)}
              </Button>
            ))}
          </div>
        )}
      >
        {ctx.activeGroup !== null && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-500">
            {t('questions.everyoneNote')}
          </p>
        )}
        {questions && questions.questions.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink-muted">{t('questions.difficulty')}:</span>
              <Chip active={difficulty === 'all'} onClick={() => setDifficulty('all')}>
                {t('questions.allN', { n: questions.questions.length })}
              </Chip>
              {(['difficult', 'medium', 'easy'] as Difficulty[]).map(d => (
                <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>
                  {t(`questions.levelN.${d}`, { n: difficultyCount[d], easy: DIFFICULTY_CUTOFFS.easy, below: DIFFICULTY_CUTOFFS.easy - 1, medium: DIFFICULTY_CUTOFFS.medium })}
                </Chip>
              ))}
            </div>
            {topics.length > 0 && (
              <label className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
                {t('questions.topic')}:
                <select
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-normal text-ink focus:border-primary focus:outline-none"
                >
                  <option value="">{t('questions.allTopics')}</option>
                  {topics.map(tp => <option key={tp} value={tp}>{tp}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {!ctx.questionsLoaded ? (
          <p className="text-sm text-ink-muted">{t('questions.loading')}</p>
        ) : !questions || questions.questions.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('questions.none')}</p>
        ) : questionRows.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('questions.noneMatch')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="sticky top-0 z-[1] bg-surface text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="w-12 pb-2 text-left">#</th>
                  <th className="pb-2 text-left">{t('questions.question')}</th>
                  <th className="w-[22%] pb-2 text-left">{t('questions.correctPct')}</th>
                  <th className="w-[30%] pb-2 text-left">{t('questions.wrongAnswers')}</th>
                  <th className="w-20 pb-2 text-center">{t('questions.blank')}</th>
                </tr>
              </thead>
              <tbody>
                {questionRows.map(q => {
                  const level = q.writers > 0 ? questionDifficulty(q) : null;
                  const wrong = wrongAnswers(q);
                  return (
                    <tr key={q.id} className="border-t border-border align-top">
                      <td className="py-3 text-base font-bold tabular-nums text-ink-muted">Q{q.number}</td>
                      <td className="py-3 pr-4">
                        <div className="line-clamp-3 text-ink" title={q.text}>{q.text}</div>
                        {q.correct_label && (
                          <div className="mt-1 text-sm font-medium text-success-600">
                            {t('questions.answerIs', { label: q.correct_label, text: q.correct_text ?? '' })}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {level && (
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-semibold',
                              level === 'difficult' ? 'bg-error-50 text-error-600 dark:bg-error-500/15'
                                : level === 'medium' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400'
                                  : 'bg-success-50 text-success-600 dark:bg-success-500/15',
                            )}>{t(`questions.level.${level}`)}</span>
                          )}
                          {(q.topic || q.subtopic) && (
                            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-muted">
                              {[q.topic, q.subtopic].filter(Boolean).join(' › ')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <InlineBar value={pctOf(q.correct, q.writers)} />
                        <div className="mt-1 text-xs text-ink-muted">{t('scorecard.nOfM', { n: q.correct, m: q.writers })}</div>
                      </td>
                      <td className="py-3 pr-3">
                        {wrong.length === 0 ? <span className="text-sm text-ink-muted">—</span> : (
                          <ul className="space-y-1">
                            {wrong.map(w => (
                              <li key={w.label} className="flex items-baseline gap-2 text-sm" title={w.text}>
                                <span className="w-11 shrink-0 text-right font-bold tabular-nums text-error-600">{fmtPct(w.pct)}</span>
                                <span className="min-w-0 truncate text-ink"><strong>{w.label}</strong> {w.text}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="py-3 text-center text-sm font-semibold tabular-nums text-ink-muted">
                        {q.writers ? fmtPct(pctOf(q.unanswered, q.writers)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Top scorers + who needs support */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          icon={<Award />}
          title={topDir === 'top'
            ? (topN === 'all' ? t('testPage.allScorers') : t('testPage.topTitleN', { n: topN }))
            : (topN === 'all' ? t('testPage.allScorersLow') : t('testPage.bottomTitleN', { n: topN }))}
          subtitle={topDir === 'top' ? t('testPage.topSubtitle', { test: test.label }) : t('testPage.bottomSubtitle', { test: test.label })}
        >
          <div className="mb-3"><CountPicker n={topN} onN={setTopN} dir={topDir} onDir={setTopDir} /></div>
          <LearnerTable rows={top} test={test} ranked />
        </Section>
        <Section icon={<LifeBuoy />} title={t('testPage.supportTitle')} subtitle={t('testPage.supportSubtitle', { test: test.label })}>
          <div className="mb-3"><CountPicker n={supportN} onN={setSupportN} /></div>
          {support.length === 0
            ? <p className="text-sm text-ink-muted">{t('testPage.everyonePassed')}</p>
            : <LearnerTable rows={support} test={test} />}
        </Section>
      </div>
    </div>
  );
};

const LearnerTable: React.FC<{ rows: UserResultRow[]; test: ActiveTest; ranked?: boolean }> = ({ rows, test, ranked }) => {
  const { t } = useTranslation('resultsInsights');
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            {ranked && <th className="w-10 pb-2 text-left">#</th>}
            <th className="pb-2 text-left">{t('top.learner')}</th>
            <th className="pb-2 text-left">{t('dim.cadre')}</th>
            <th className="pb-2 text-center">{t('testPage.bestScore')}</th>
            <th className="pb-2 text-center">{t('testPage.attempts')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u, i) => {
            const r = u.tests[String(test.id)];
            return (
              <tr key={u.user_id} className="border-t border-border">
                {ranked && <td className="py-2"><RankBadge rank={i + 1} /></td>}
                <td className="py-2">
                  <div className="font-semibold text-ink">{u.name}</div>
                  <div className="text-xs text-ink-muted">{u.profile?.block ?? ''}</div>
                </td>
                <td className="py-2 text-ink-muted">{u.profile?.cadre ?? '—'}</td>
                <td className="py-2 text-center font-display font-extrabold tabular-nums" style={{ color: toneColor(r.best_score ?? 0) }}>
                  {fmtPct(r.best_score ?? 0)}
                </td>
                <td className="py-2 text-center tabular-nums text-ink-muted">{r.attempts_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TestInsights;
