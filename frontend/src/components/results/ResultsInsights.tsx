/**
 * Results → Insights: the test results of a whole project, for managers.
 *
 * Reads top to bottom like a briefing: the headline, the four numbers that
 * matter, the learner journey, findings in plain sentences, then the detail —
 * groups compared (cadre, block, experience, …), each test, each video, and
 * the top performers. Clicking any group narrows the WHOLE dashboard to it.
 */
import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Award, BookOpenCheck, CheckCircle2, ClipboardCheck, Download, Filter, GraduationCap,
  Lightbulb, PlayCircle, Sparkles, ThumbsUp, TriangleAlert, UserPlus, Users, X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Badge, Button, Card } from '../ui';
import { cn } from '../../utils/cn';
import { CHART_SERIES } from '../../utils/brandColors';
import {
  BarList, Donut, Journey, Ring, StackedBar,
  type BarRow, type Slice,
} from './InsightCharts';
import {
  NOT_RECORDED, activeTests, cohortStats, findings, fmtPct, groupOf, groupStats, journey, toneColor,
  overallScore, topPerformers, usefulDimensions, videoStats,
  type ActiveTest, type DimensionKey, type Finding, type GroupStats,
  type ResultsData, type TestMeta, type UserResultRow,
} from '../../lib/resultsInsights';

/** Literal class names (Tailwind cannot see computed ones): tiles per row. */
const KPI_COLS: Record<number, string> = {
  3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6',
};

interface Focus {
  dim: DimensionKey;
  group: string;
}

const Section: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, actions, className, children }) => (
  <Card className={cn('p-5 sm:p-6', className)}>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300 [&>svg]:size-5">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
    {children}
  </Card>
);

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'border-primary bg-primary text-primary-fg'
        : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
    )}
  >
    {children}
  </button>
);

/** A headline number: the picture on top, the words underneath. */
const Kpi: React.FC<{ visual: React.ReactNode; label: string; value: React.ReactNode; note?: string }> = ({ visual, label, value, note }) => (
  <Card className="flex flex-col items-center gap-3 p-5 text-center">
    {visual}
    <div className="min-w-0">
      <div className="text-sm font-semibold text-ink">{label}</div>
      <div className="text-sm text-ink-muted">{value}</div>
      {note && <div className="text-xs text-ink-faint">{note}</div>}
    </div>
  </Card>
);

/** A value in a scorecard cell, tinted by how good it is. */
const ScoreCell: React.FC<{ value: number | null; sub?: string }> = ({ value, sub }) => {
  if (value === null) return <td className="px-3 py-2 text-center text-ink-faint">—</td>;
  const c = toneColor(value);
  return (
    <td className="px-2 py-1.5 text-center">
      <span
        className="inline-block min-w-14 rounded-md px-2 py-1 text-sm font-bold tabular-nums"
        style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}
      >
        {fmtPct(value)}
      </span>
      {sub && <div className="text-[0.7rem] text-ink-faint">{sub}</div>}
    </td>
  );
};

const ResultsInsights: React.FC<{ data: ResultsData }> = ({ data }) => {
  const { t } = useTranslation('resultsInsights');

  const labelFor = (test: TestMeta) =>
    test.test_type === 'formative' ? t('testName.formative')
      : test.test_type === 'screening' ? t('testName.screening')
        : test.title;
  const tests = useMemo(() => activeTests(data, labelFor), [data, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastTest: ActiveTest | undefined = tests[tests.length - 1];

  const dims = useMemo(() => usefulDimensions(data.users), [data.users]);
  const [dim, setDim] = useState<DimensionKey>(dims.includes('cadre') ? 'cadre' : dims[0] ?? 'cadre');
  const [focus, setFocus] = useState<Focus | null>(null);
  const [metric, setMetric] = useState<string>(lastTest ? `pass:${lastTest.id}` : 'videos');

  const groupLabel = (g: string, d: DimensionKey = dim): string => {
    if (g === NOT_RECORDED) return t('notRecorded');
    if (d === 'ageGroup') return t(`age.${g}`, { defaultValue: g });
    if (d === 'internet') return t(`internet.${g}`, { defaultValue: g });
    if (d === 'priorTraining') return t(`priorTraining.${g}`, { defaultValue: g });
    return g;
  };

  // The dashboard's population: everyone, or the focused group.
  const users = useMemo(
    () => (focus ? data.users.filter(u => (groupOf(u, focus.dim) ?? NOT_RECORDED) === focus.group) : data.users),
    [data.users, focus],
  );
  // The comparison splits the focused population by another dimension (a
  // cross-section: "ASHAs, by block"), or everyone when comparing the very
  // dimension that is focused (so the focused group stays highlighted).
  const compareBase = focus && focus.dim !== dim ? users : data.users;

  const overall = useMemo(() => cohortStats(users, tests), [users, tests]);
  const groups = useMemo(() => groupStats(compareBase, dim, tests), [compareBase, dim, tests]);
  const videos = useMemo(() => videoStats(data, users), [data, users]);
  const steps = useMemo(() => journey(users, tests), [users, tests]);
  const facts = useMemo(
    () => findings(users, tests, dim, groupStats(users, dim, tests), videos, g => groupLabel(g)),
    [users, tests, dim, videos], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const top = useMemo(() => topPerformers(users, tests, 10), [users, tests]);

  const toggleFocus = (group: string) =>
    setFocus(f => (f && f.dim === dim && f.group === group ? null : { dim, group }));
  const activeGroup = focus && focus.dim === dim ? focus.group : null;
  const colorOf = (i: number) => CHART_SERIES[i % CHART_SERIES.length];

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
      key: g.group,
      label: groupLabel(g.group),
      value: v as number,
      display: fmtPct(v as number),
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

  function findingText(f: Finding): string {
    return t(`finding.${f.key}`, { ...f.params, dimName: t(`dimSingular.${String(f.params.dim ?? dim)}`) });
  }

  // ── Render ──
  const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
  const lastStats = lastTest ? overall.tests[lastTest.id] : undefined;

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
                {lastTest && lastStats
                  ? t('hero.sentence', {
                    project: data.district_name, n: overall.n, passed: lastStats.passed,
                    pct: Math.round(pctOf(lastStats.passed, overall.n)), test: lastTest.label, selected: overall.selected,
                  })
                  : t('hero.noTests', { project: data.district_name, n: overall.n })}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{t('hero.hint')}</p>
            </div>
            <Button variant="outline" iconLeft={<Download className="size-4" />} onClick={downloadSummary}>
              {t('download')}
            </Button>
          </div>
        </div>
        {focus && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border bg-amber-50 px-5 py-3 text-sm dark:bg-amber-500/10">
            <Filter className="size-4 text-amber-700 dark:text-amber-500" />
            <span className="text-ink">
              {t('focus.showing', { group: groupLabel(focus.group, focus.dim), dimName: t(`dimSingular.${focus.dim}`), n: users.length })}
            </span>
            <Button size="sm" variant="outline" iconLeft={<X className="size-3.5" />} onClick={() => setFocus(null)}>
              {t('focus.clear')}
            </Button>
          </div>
        )}
      </Card>

      {/* The numbers that matter */}
      <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3', KPI_COLS[Math.min(3 + tests.length, 6)])}>
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
      </div>

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
          {facts.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('findings.none')}</p>
          ) : (
            <ul className="space-y-3">
              {facts.map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&>svg]:size-4',
                    f.tone === 'good' && 'bg-success-50 text-success-600 dark:bg-success-500/15',
                    f.tone === 'watch' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
                    f.tone === 'info' && 'bg-surface-sunken text-ink-muted',
                  )}>
                    {f.tone === 'good' ? <ThumbsUp /> : f.tone === 'watch' ? <TriangleAlert /> : <Lightbulb />}
                  </span>
                  <span className="text-sm leading-relaxed text-ink">{findingText(f)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Compare groups */}
      {dims.length > 0 && (
        <Section
          icon={<Users />}
          title={t('compare.title')}
          subtitle={focus && focus.dim !== dim
            ? t('compare.subtitleWithin', { group: groupLabel(focus.group, focus.dim) })
            : t('compare.subtitle')}
        >
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-semibold text-ink-muted">{t('compare.splitBy')}</span>
            {dims.map(d => (
              <Chip key={d} active={d === dim} onClick={() => setDim(d)}>{t(`dim.${d}`)}</Chip>
            ))}
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
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

          {/* Scorecard */}
          <div className="mt-8">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink">{t('scorecard.title', { dim: t(`dim.${dim}`) })}</h4>
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-success-500" />{t('scorecard.good')}</span>
                <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500" />{t('scorecard.ok')}</span>
                <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-error-500" />{t('scorecard.low')}</span>
              </div>
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

      {/* Each test */}
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
              >
                <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                  <Ring value={s.passRate} size={104} stroke={11} />
                  <dl className="grid w-full grid-cols-3 gap-2 text-center sm:flex-1 sm:gap-3">
                    {([
                      [t('test.wrote'), String(s.wrote), undefined],
                      [t('test.passed'), String(s.passed), '#2F9E56'],
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
                  { key: 'ex', label: t('test.bandExcellent', { from: excellentFrom }), value: s.bands.excellent, color: '#2F9E56' },
                  { key: 'ok', label: t('test.bandPassed', { from: test.passMark, to: excellentFrom - 1 }), value: s.bands.passed, color: '#7FC49A' },
                  { key: 'near', label: t('test.bandNear', { from: Math.max(0, test.passMark - 20), to: test.passMark - 1 }), value: s.bands.nearMiss, color: '#F59E0B' },
                  { key: 'low', label: t('test.bandSupport', { below: Math.max(0, test.passMark - 20) }), value: s.bands.support, color: '#DC2F2F' },
                ]} />
                <h4 className="mb-2 mt-5 text-sm font-semibold text-ink">{t('test.attemptsTitle')}</h4>
                <StackedBar parts={[
                  { key: 'first', label: t('test.firstTry'), value: s.firstTry, color: '#2F9E56' },
                  { key: 'retake', label: t('test.afterRetake'), value: s.afterRetake, color: '#4F7CAC' },
                  { key: 'not', label: t('test.notPassed'), value: s.notPassed, color: '#DC2F2F' },
                ]} />
              </Section>
            );
          })}
        </div>
      ) : (
        <Card className="p-6 text-sm text-ink-muted">{t('noTests')}</Card>
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
                    <td className="py-2.5 pr-4">
                      <InlineBar value={v.finishedPct} />
                    </td>
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

      {/* Top performers */}
      {top.length > 0 && (
        <Section icon={<Award />} title={t('top.title')} subtitle={t('top.subtitle')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="w-10 pb-2 text-left">#</th>
                  <th className="pb-2 text-left">{t('top.learner')}</th>
                  <th className="pb-2 text-left">{t('dim.cadre')}</th>
                  <th className="pb-2 text-left">{t('dim.block')}</th>
                  {tests.map(test => <th key={test.id} className="pb-2 text-center">{test.label}</th>)}
                  <th className="pb-2 text-center">{t('top.average')}</th>
                  <th className="pb-2 text-center">{t('top.faceToFace')}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((u: UserResultRow, i) => (
                  <tr key={u.user_id} className="border-t border-border">
                    <td className="py-2">
                      <span className={cn(
                        'flex size-7 items-center justify-center rounded-full text-xs font-bold',
                        i === 0 ? 'bg-amber-500 text-white' : i < 3 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-500' : 'bg-surface-sunken text-ink-muted',
                      )}>{i + 1}</span>
                    </td>
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
                      {fmtPct(overallScore(u, tests) ?? 0)}
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
        </Section>
      )}
    </div>
  );
};

const InlineBar: React.FC<{ value: number; note?: string }> = ({ value, note }) => (
  <div className="flex items-center gap-2.5">
    <span className="relative h-2.5 flex-1 rounded-full bg-surface-sunken">
      <span className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: toneColor(value), transition: 'width 500ms ease' }} />
    </span>
    <span className="w-11 text-right text-sm font-bold tabular-nums text-ink">{fmtPct(value)}</span>
    {note && <span className="hidden text-xs text-ink-faint md:inline">{note}</span>}
  </div>
);

export default ResultsInsights;
