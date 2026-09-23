/**
 * Results → Insights → tests compared (Formative vs Screening): the same
 * learners on two tests. Who wrote both, how the average moved, who passed
 * one and not the other, and — split by cadre, block, experience, … — which
 * groups held up and which fell back.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Download, Grid3x3, Info, Lightbulb, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button, Card } from '../ui';
import { cn } from '../../utils/cn';
import { TEST_A_COLOR, TEST_B_COLOR } from '../../utils/brandColors';
import { HeatGrid, PairedBars, Ring, StackedBar, type PairedRow } from './InsightCharts';
import { BigNumber, ChipRow, FindingList, Kpi, KpiRow, ScoreCell, Section, ToneLegend } from './InsightParts';
import {
  GRID_BANDS, compareFindings, fmtPct, pairGroupStats, pairStats, signed,
  type Finding, type PairStats,
} from '../../lib/resultsInsights';
import type { InsightCtx } from './types';

type Measure = 'score' | 'pass';

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const CompareTests: React.FC<{ ctx: InsightCtx }> = ({ ctx }) => {
  const { t } = useTranslation('resultsInsights');
  const { data, tests, users, compareBase, dims, dim, setDim, activeGroup, toggleFocus, groupLabel } = ctx;
  const [aId, setAId] = useState<number>(tests[0].id);
  const [bId, setBId] = useState<number>(tests[tests.length - 1].id);
  const [measure, setMeasure] = useState<Measure>('score');
  const a = tests.find(x => x.id === aId) ?? tests[0];
  const b = tests.find(x => x.id === bId) ?? tests[tests.length - 1];

  const s = useMemo(() => pairStats(users, a, b), [users, a, b]);
  const rows = useMemo(() => pairGroupStats(compareBase, dim, a, b), [compareBase, dim, a, b]);
  const facts = useMemo(
    () => compareFindings(users, a, b, dim, g => groupLabel(g)),
    [users, a, b, dim], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const findingText = (f: Finding) =>
    t(`finding.${f.key}`, { ...f.params, dimName: t(`dimSingular.${String(f.params.dim ?? dim)}`) });

  const valueOf = (p: PairStats): [number, number] => (measure === 'score' ? [p.avgA, p.avgB] : [p.passRateA, p.passRateB]);
  const paired: PairedRow[] = rows
    .filter(r => r.n > 0)
    .map(r => {
      const [va, vb] = valueOf(r);
      return { key: r.group, label: groupLabel(r.group), a: va, b: vb, sub: t('cmp.wroteBothN', { n: r.n }) };
    });

  const download = () => {
    const wb = XLSX.utils.book_new();
    const all = pairStats(data.users, a, b);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [t('excel.project'), data.district_name],
      [t('cmp.wroteBoth'), all.n],
      [t('cmp.avgOf', { test: a.label }), Math.round(all.avgA)],
      [t('cmp.avgOf', { test: b.label }), Math.round(all.avgB)],
      [t('cmp.change'), Math.round(all.change)],
      [t('cmp.improved'), all.improved], [t('cmp.same'), all.same], [t('cmp.dropped'), all.dropped],
      [t('cmp.passBoth'), all.passBoth],
      [t('cmp.passOnly', { test: a.label }), all.passAOnly],
      [t('cmp.passOnly', { test: b.label }), all.passBOnly],
      [t('cmp.passNeither'), all.passNeither],
      [],
      [t('findings.title')],
      ...compareFindings(data.users, a, b, 'cadre', g => groupLabel(g, 'cadre')).map(f => [findingText(f)]),
    ]), t('excel.overviewSheet').slice(0, 31));
    for (const d of dims) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [t(`dim.${d}`), t('cmp.wroteBoth'), t('cmp.avgOf', { test: a.label }), t('cmp.avgOf', { test: b.label }),
          t('cmp.change'), t('cmp.passRateOf', { test: a.label }), t('cmp.passRateOf', { test: b.label }), t('cmp.passBoth')],
        ...pairGroupStats(data.users, d, a, b).map(r => [
          groupLabel(r.group, d), r.n, Math.round(r.avgA), Math.round(r.avgB), Math.round(r.change),
          Math.round(r.passRateA), Math.round(r.passRateB), r.passBoth,
        ]),
      ]), t(`dim.${d}`).replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
    }
    XLSX.writeFile(wb, `results_${data.district}_tests_compared.xlsx`);
  };

  const testPicker = (value: number, onChange: (id: number) => void, other: number) => (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink focus:border-primary focus:outline-none"
    >
      {tests.filter(x => x.id !== other).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
    </select>
  );

  return (
    <div className="space-y-6">
      {/* Headline */}
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-r from-coral-50 via-surface to-sage-50 p-5 sm:p-6 dark:from-coral-500/10 dark:via-surface dark:to-sage-500/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary-ink">
                <ArrowRightLeft className="size-3.5" /> {t('cmp.eyebrow', { a: a.label, b: b.label })}
              </div>
              <h2 className="font-display text-xl font-extrabold text-ink sm:text-2xl">
                {s.n > 0
                  ? t('cmp.sentence', { n: s.n, a: a.label, b: b.label, avgA: Math.round(s.avgA), avgB: Math.round(s.avgB), change: signed(s.change) })
                  : t('cmp.nobody', { a: a.label, b: b.label })}
              </h2>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted">
                <Info className="mt-0.5 size-4 shrink-0" /> {t('cmp.differentPapers')}
              </p>
              {tests.length > 2 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                  {t('cmp.pick')} {testPicker(aId, setAId, bId)} <span>vs</span> {testPicker(bId, setBId, aId)}
                </div>
              )}
            </div>
            <Button variant="outline" iconLeft={<Download className="size-4" />} onClick={download}>
              {t('cmp.download')}
            </Button>
          </div>
        </div>
      </Card>

      {s.n > 0 && (<>
        <KpiRow count={5}>
          <Kpi visual={<BigNumber value={s.n} />} label={t('cmp.wroteBoth')} value={t('cmp.ofLearners', { n: users.length })} />
          <Kpi visual={<Ring value={s.avgA} color={TEST_A_COLOR} />} label={t('cmp.avgOf', { test: a.label })}
            value={t('cmp.passedPct', { pct: Math.round(s.passRateA) })} />
          <Kpi visual={<Ring value={s.avgB} color={TEST_B_COLOR} />} label={t('cmp.avgOf', { test: b.label })}
            value={t('cmp.passedPct', { pct: Math.round(s.passRateB) })} />
          <Kpi visual={<BigNumber value={signed(s.change)} tone={Math.abs(s.change) < 1 ? 'neutral' : s.change > 0 ? 'good' : 'bad'} />}
            label={t('cmp.change')} value={t('cmp.points')} />
          <Kpi visual={<Ring value={pctOf(s.passBoth, s.n)} />} label={t('cmp.passBoth')}
            value={t('scorecard.nOfM', { n: s.passBoth, m: s.n })} />
        </KpiRow>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section icon={<Lightbulb />} title={t('findings.title')} subtitle={t('cmp.findingsSubtitle')}>
            <FindingList findings={facts} text={findingText} empty={t('findings.none')} />
          </Section>

          <Section icon={<ArrowRightLeft />} title={t('cmp.outcomesTitle')} subtitle={t('cmp.outcomesSubtitle')}>
            <div className="grid grid-cols-2 gap-3">
              {([
                ['both', t('cmp.passBoth'), s.passBoth, '#2F9E56'],
                ['aOnly', t('cmp.passOnly', { test: a.label }), s.passAOnly, '#F59E0B'],
                ['bOnly', t('cmp.passOnly', { test: b.label }), s.passBOnly, TEST_B_COLOR],
                ['neither', t('cmp.passNeither'), s.passNeither, '#DC2F2F'],
              ] as [string, string, number, string][]).map(([key, label, n, color]) => (
                <div key={key} className="rounded-xl border border-border p-4"
                  style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
                  <div className="text-sm font-semibold text-ink">{label}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-display text-3xl font-extrabold tabular-nums" style={{ color }}>{n}</span>
                    <span className="text-sm tabular-nums text-ink-muted">{fmtPct(pctOf(n, s.n))}</span>
                  </div>
                </div>
              ))}
            </div>
            <h4 className="mb-2 mt-6 text-sm font-semibold text-ink">{t('cmp.movementTitle', { a: a.label, b: b.label })}</h4>
            <StackedBar parts={[
              { key: 'up', label: t('cmp.improved'), value: s.improved, color: '#2F9E56' },
              { key: 'same', label: t('cmp.same'), value: s.same, color: '#A8A29E' },
              { key: 'down', label: t('cmp.dropped'), value: s.dropped, color: '#DC2F2F' },
            ]} />
          </Section>
        </div>

        {/* Across variables */}
        {dims.length > 0 && (
          <Section icon={<Users />} title={t('cmp.groupsTitle')} subtitle={t('compare.subtitle')}>
            <ChipRow
              label={t('compare.splitBy')}
              items={dims.map(d => ({ key: d, label: t(`dim.${d}`) }))}
              value={dim}
              onChange={k => setDim(k as typeof dim)}
            />
            <div className="mb-4 mt-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{t('compare.show')}</span>
              <select
                value={measure}
                onChange={e => setMeasure(e.target.value as Measure)}
                className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
              >
                <option value="score">{t('cmp.measureScore')}</option>
                <option value="pass">{t('cmp.measurePass')}</option>
              </select>
            </div>
            <PairedBars
              rows={paired}
              colorA={TEST_A_COLOR}
              colorB={TEST_B_COLOR}
              labelA={a.label}
              labelB={b.label}
              changeLabel={c => t('cmp.changeChip', { change: signed(c) })}
              activeKey={activeGroup}
              onSelect={toggleFocus}
              selectHint={t('compare.clickHint')}
            />

            <div className="mt-8">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">{t('scorecard.title', { dim: t(`dim.${dim}`) })}</h4>
                <ToneLegend good={t('scorecard.good')} ok={t('scorecard.ok')} low={t('scorecard.low')} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-3 py-2.5 text-left">{t(`dim.${dim}`)}</th>
                      <th className="px-3 py-2.5 text-center">{t('cmp.wroteBoth')}</th>
                      <th className="px-3 py-2.5 text-center">{t('cmp.avgOf', { test: a.label })}</th>
                      <th className="px-3 py-2.5 text-center">{t('cmp.avgOf', { test: b.label })}</th>
                      <th className="px-3 py-2.5 text-center">{t('cmp.change')}</th>
                      <th className="px-3 py-2.5 text-center">{t('cmp.passRateOf', { test: a.label })}</th>
                      <th className="px-3 py-2.5 text-center">{t('cmp.passRateOf', { test: b.label })}</th>
                      <th className="px-3 py-2.5 text-center">{t('cmp.passBoth')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={r.group}
                        onClick={() => toggleFocus(r.group)}
                        title={t('compare.clickHint')}
                        className={cn(
                          'cursor-pointer border-t border-border transition-colors hover:bg-surface-sunken',
                          activeGroup === r.group && 'bg-surface-sunken',
                          activeGroup && activeGroup !== r.group && 'opacity-50',
                        )}
                      >
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-2 font-semibold text-ink">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: ctx.colorOf(i) }} />
                            {groupLabel(r.group)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center font-semibold tabular-nums text-ink">{r.n}</td>
                        <ScoreCell value={r.n ? r.avgA : null} />
                        <ScoreCell value={r.n ? r.avgB : null} />
                        <td className="px-3 py-2 text-center">
                          {r.n > 0 && (
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                              Math.abs(r.change) < 1 ? 'bg-surface-sunken text-ink-muted'
                                : r.change > 0 ? 'bg-success-50 text-success-600 dark:bg-success-500/15'
                                  : 'bg-error-50 text-error-600 dark:bg-error-500/15',
                            )}>{signed(r.change)}</span>
                          )}
                        </td>
                        <ScoreCell value={r.n ? r.passRateA : null} />
                        <ScoreCell value={r.n ? r.passRateB : null} />
                        <ScoreCell value={r.n ? pctOf(r.passBoth, r.n) : null} sub={r.n ? t('scorecard.nOfM', { n: r.passBoth, m: r.n }) : undefined} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>
        )}

        {/* Where each learner landed */}
        <Section icon={<Grid3x3 />} title={t('cmp.gridTitle')} subtitle={t('cmp.gridSubtitle', { a: a.label, b: b.label })}>
          <HeatGrid
            grid={s.grid}
            bands={GRID_BANDS}
            labelA={t('cmp.scoreIn', { test: a.label })}
            labelB={t('cmp.scoreIn', { test: b.label })}
            color={TEST_B_COLOR}
            cellTitle={(n, ba, bb) => t('cmp.cellTitle', { n, a: a.label, b: b.label, ba, bb })}
          />
          <p className="mt-3 text-xs text-ink-muted">{t('cmp.gridHow')}</p>
        </Section>
      </>)}
    </div>
  );
};

export default CompareTests;
