/**
 * Results → Insights → one test (the Formative test page, the Screening test
 * page, …): everything about a single test on its own — how many wrote and
 * passed, how the scores are spread, which groups did well, which questions
 * people got wrong, and who needs support.
 */
import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Award, ClipboardCheck, Download, HelpCircle, LifeBuoy, Lightbulb, RotateCcw, Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button, Card } from '../ui';
import { cn } from '../../utils/cn';
import { BAND_COLORS } from '../../utils/brandColors';
import { BarList, Donut, Histogram, Ring, StackedBar, type BarRow, type Slice } from './InsightCharts';
import {
  BigNumber, ChipRow, FindingList, InlineBar, Kpi, KpiRow, RankBadge, ScoreCell, Section, ToneLegend,
} from './InsightParts';
import {
  fmtPct, lowestScorers, scoreDistribution, testFindings, testGroupStats, testStats, toneColor, topScorers,
  type ActiveTest, type Finding, type TestStats, type UserResultRow,
} from '../../lib/resultsInsights';
import type { InsightCtx } from './types';

type Measure = 'pass' | 'score' | 'firstTry';
type QuestionOrder = 'hardest' | 'paper';

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const TestInsights: React.FC<{ ctx: InsightCtx; test: ActiveTest }> = ({ ctx, test }) => {
  const { t } = useTranslation('resultsInsights');
  const { data, users, compareBase, dims, dim, setDim, activeGroup, toggleFocus, groupLabel, colorOf } = ctx;
  const [measure, setMeasure] = useState<Measure>('pass');
  const [order, setOrder] = useState<QuestionOrder>('hardest');

  const s = useMemo(() => testStats(users, test), [users, test]);
  const groups = useMemo(() => testGroupStats(compareBase, dim, test), [compareBase, dim, test]);
  const base = useMemo(() => testStats(compareBase, test), [compareBase, test]);
  const questions = ctx.questions[test.id];
  const bars = useMemo(
    () => scoreDistribution(users, test, questions?.questions.length), [users, test, questions],
  );
  const facts = useMemo(
    () => testFindings(users, test, dim, g => groupLabel(g), questions),
    [users, test, dim, questions], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const top = useMemo(() => topScorers(users, test, 10), [users, test]);
  const support = useMemo(() => lowestScorers(users, test, 10), [users, test]);

  const findingText = (f: Finding) =>
    t(`finding.${f.key}`, { ...f.params, dimName: t(`dimSingular.${String(f.params.dim ?? dim)}`) });
  const excellentFrom = Math.max(85, test.passMark);
  const nearFrom = Math.max(0, test.passMark - 20);

  const bandParts = (st: TestStats): Slice[] => [
    { key: 'ex', label: t('test.bandExcellent', { from: excellentFrom }), value: st.bands.excellent, color: BAND_COLORS.excellent },
    { key: 'ok', label: t('test.bandPassed', { from: test.passMark, to: excellentFrom - 1 }), value: st.bands.passed, color: BAND_COLORS.passed },
    { key: 'near', label: t('test.bandNear', { from: nearFrom, to: test.passMark - 1 }), value: st.bands.nearMiss, color: BAND_COLORS.nearMiss },
    { key: 'low', label: t('test.bandSupport', { below: nearFrom }), value: st.bands.support, color: BAND_COLORS.support },
  ];

  const measureValue = (st: TestStats): number | null => {
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
      sub: t('testPage.wroteOfN', { n: g.stats.wrote }),
    }));
  const writersSlices: Slice[] = groups
    .map((g, i) => ({ key: g.group, label: groupLabel(g.group), value: g.stats.wrote, color: colorOf(i) }));

  const questionRows = useMemo(() => {
    const qs = [...(questions?.questions ?? [])];
    if (order === 'hardest') qs.sort((a, b) => pctOf(a.correct, a.writers) - pctOf(b.correct, b.writers));
    return qs;
  }, [questions, order]);

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
        ['#', t('questions.question'), t('questions.rightAnswer'), t('questions.correctPct'),
          t('questions.correctN'), t('questions.topWrong'), t('questions.blank')],
        ...questions.questions.map(q => [
          q.number, q.text, `${q.correct_label ?? ''} ${q.correct_text ?? ''}`.trim(),
          Math.round(pctOf(q.correct, q.writers)), q.correct,
          q.top_wrong_label ? `${q.top_wrong_label}: ${q.top_wrong_text ?? ''} (${q.top_wrong_count})` : '',
          q.unanswered,
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
          <ChipRow
            label={t('compare.splitBy')}
            items={dims.map(d => ({ key: d, label: t(`dim.${d}`) }))}
            value={dim}
            onChange={k => setDim(k as typeof dim)}
          />
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <div>
              <h4 className="mb-3 text-sm font-semibold text-ink">{t('testPage.whoWrote', { dim: t(`dim.${dim}`) })}</h4>
              <Donut
                slices={writersSlices}
                centerValue={base.wrote}
                centerLabel={t('testPage.wroteIt')}
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
                        {g.stats.wrote > 0 && <StackedBar parts={bandParts(g.stats)} height="h-3" showLegend={false} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              {bandParts(s).map(p => (
                <span key={p.key} className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ background: p.color }} />{p.label}
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
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-500">
            {t('questions.everyoneNote')}
          </p>
        )}
        {!ctx.questionsLoaded ? (
          <p className="text-sm text-ink-muted">{t('questions.loading')}</p>
        ) : !questions || questions.questions.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('questions.none')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="w-10 pb-2 text-left">#</th>
                  <th className="pb-2 text-left">{t('questions.question')}</th>
                  <th className="w-[26%] pb-2 text-left">{t('questions.correctPct')}</th>
                  <th className="w-[24%] pb-2 text-left">{t('questions.topWrong')}</th>
                  <th className="w-16 pb-2 text-center">{t('questions.blank')}</th>
                </tr>
              </thead>
              <tbody>
                {questionRows.map(q => (
                  <tr key={q.id} className="border-t border-border align-top">
                    <td className="py-2.5 font-semibold tabular-nums text-ink-muted">Q{q.number}</td>
                    <td className="py-2.5 pr-4">
                      <div className="line-clamp-2 text-ink" title={q.text}>{q.text}</div>
                      {q.correct_label && (
                        <div className="mt-0.5 text-xs text-success-600">
                          {t('questions.answerIs', { label: q.correct_label, text: q.correct_text ?? '' })}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <InlineBar value={pctOf(q.correct, q.writers)} />
                      <div className="mt-0.5 text-xs text-ink-faint">{t('scorecard.nOfM', { n: q.correct, m: q.writers })}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-ink-muted">
                      {q.top_wrong_label
                        ? <><strong className="text-error-600">{q.top_wrong_label}</strong> {q.top_wrong_text} <span className="text-ink-faint">({q.top_wrong_count})</span></>
                        : '—'}
                    </td>
                    <td className="py-2.5 text-center tabular-nums text-ink-muted">{q.unanswered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Top scorers + who needs support */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={<Award />} title={t('testPage.topTitle')} subtitle={t('testPage.topSubtitle', { test: test.label })}>
          <LearnerTable rows={top} test={test} ranked />
        </Section>
        <Section icon={<LifeBuoy />} title={t('testPage.supportTitle')} subtitle={t('testPage.supportSubtitle', { test: test.label })}>
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
                  <div className="text-xs text-ink-faint">{u.profile?.block ?? ''}</div>
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
