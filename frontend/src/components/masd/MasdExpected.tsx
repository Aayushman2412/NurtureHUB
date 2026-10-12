import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, ChartColumn, ChartScatter, Layers3, ListChecks, Target, Timer } from 'lucide-react';
import {
  ACTIVITY_KEYS, ADOPTION_TYPES, OWN_BANDS,
  type MasdReport, type OwnBand,
} from '../../api/masd';
import { ChipRow, KpiRow, Section } from '../results/InsightParts';
import { StackedBar } from '../results/InsightCharts';
import MasdLevelKpis from './MasdLevelKpis';
import MasdLevelsExplainer from './MasdLevelsExplainer';
import MasdUptake from './MasdUptake';
import ScopeBadge from './ScopeBadge';
import MasdFindings from './MasdFindings';
import MasdBaseline from './MasdBaseline';
import { BubblePlot, DataTable, GroupedColumns, RateCell, Th } from './MasdCharts';
import { averageLines, fmt1, MASD_COLORS } from '../../lib/masdDisplay';
import { aggregate, applyFilters, groupOf, groupsOf, pct, splitBy, type MasdAgg, type TypeAgg } from '../../lib/masdSplit';
import type { MasdSplitState } from './MasdSplitBar';
import RateLegend from './RateLegend';

/** The adoption kinds a chart can show: the three types of the rest of the
 *  learners, a Staff Nurse's PNC <5M on its own (review of 6 Oct 2026), and
 *  all of them together (review of 12 Oct 2026). */
type Kind = 'all' | 'anc' | 'pnc_lt5' | 'pnc_ge5' | 'sn';
const KINDS: Kind[] = ['all', 'anc', 'pnc_lt5', 'pnc_ge5', 'sn'];
const ONE_KINDS = KINDS.filter(k => k !== 'all') as Exclude<Kind, 'all'>[];
const one = (g: MasdAgg, k: Exclude<Kind, 'all'>): TypeAgg => (k === 'sn' ? g.nurse_lt5 : g.by_type[k]);
const kindOf = (g: MasdAgg, k: Kind): TypeAgg => {
  if (k !== 'all') return one(g, k);
  const parts = ONE_KINDS.map(x => one(g, x));
  const sum = (f: (t: TypeAgg) => number) => parts.reduce((a, t) => a + f(t), 0);
  const target = sum(t => t.target), adopted = sum(t => t.adopted), expected = sum(t => t.expected), actual = sum(t => t.actual);
  return { ...parts[0], target, adopted, expected, actual, adoption_pct: pct(adopted, target), activity_pct: pct(actual, expected) };
};
const MIN_FOR_RANK = 3;

const BAND_COLORS: Record<OwnBand, string> = {
  none: '#8E3B2F', b1_20: '#D6453D', b21_40: '#E0A11B', b41_60: '#C9B458', b61_80: '#7FB069', b81_100: '#2F9E56',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Expected activity — three levels (review of 6 Oct 2026):
 *  1. ideal: the targets × the LAP table at each tranche's follow-up (126 per
 *     learner, 99 per Staff Nurse at Jalna on 7 Oct);
 *  2. for the adoptions actually taken: the same table, read for the types
 *     and tranches the learner did adopt;
 *  3. each case by its own dates (a preview of the per-case analysis).
 * Then how quickly each tranche was taken up, by the rest of the learners and
 * Staff Nurses, adoption by adoption.
 */
const MasdExpected: React.FC<{ report: MasdReport; split: MasdSplitState }> = ({ report, split }) => {
  const { t } = useTranslation('masd');
  const cal = report.calendar;
  const [kind, setKind] = useState<Kind>('all');

  const learners = useMemo(() => applyFilters(report.learners.filter(l => l.f2f), split.filters), [report.learners, split.filters]);
  const groups = useMemo(() => splitBy(learners, split.dim), [learners, split.dim]);
  const total = useMemo(() => aggregate(learners, 'total', t('table.total')), [learners, t]);
  const word = t(`splitDims.${split.dim}`);

  const ranked = groups.filter(g => g.learners >= MIN_FOR_RANK && kindOf(g, kind).activity_pct != null);
  const best = ranked.length >= 2 ? ranked.reduce((a, b) => (kindOf(b, kind).activity_pct! > kindOf(a, kind).activity_pct! ? b : a)) : null;
  const worst = ranked.length >= 2 ? ranked.reduce((a, b) => (kindOf(b, kind).activity_pct! < kindOf(a, kind).activity_pct! ? b : a)) : null;

  const example = cal.batches[0];
  const tranches = useMemo(() => example?.expected.tranches ?? [], [example]);
  const sameClock = new Set(cal.batches.map(b => b.tranche_fu.join(','))).size <= 1;
  const namedBatches = cal.batches.filter(b => b.id != null);
  const exampleText = useMemo(() => tranches.map(tr => {
    const com = tr.community;
    const parts = ADOPTION_TYPES.filter(k => com.by_type[k]).map(k => {
      const v = com.by_type[k]!;
      const forms = ACTIVITY_KEYS.filter(a => (v.forms[a] ?? 0) > 0)
        .map(a => `${v.forms[a]} ${t(`activities.${a}`).toLowerCase()}`).join(' + ');
      return t('expected.exampleType', { n: v.adoptions, type: t(`types.${k}`), forms: forms || t('expected.nothingYet') });
    });
    return t('expected.exampleTranche', { n: tr.step, days: tr.fu_days ?? 0, parts: parts.join('; ') });
  }), [tranches, t]);
  // Learners by the share of their own cases' expected forms done (level 3),
  // per group of the Split by, recounted for the filters.
  const bandGroups = useMemo(() => [...groupsOf(learners, split.dim), 'total'].map(g => {
    const mine = g === 'total' ? learners : learners.filter(l => groupOf(l, split.dim) === g);
    const bands = Object.fromEntries(OWN_BANDS.map(b => [b, 0])) as Record<OwnBand, number>;
    for (const l of mine) if (l.own.band) bands[l.own.band] += 1;
    const banded = OWN_BANDS.reduce((a, b) => a + bands[b], 0);
    const exp = mine.reduce((a, l) => a + l.own.expected.total, 0), act = mine.reduce((a, l) => a + l.own.actual.total, 0);
    return { key: g, label: g === 'total' ? t('table.total') : g, bands, banded, pct: pct(act, exp) };
  }).filter(g => g.banded > 0), [learners, split.dim, t]);

  const typeSeries = [
    { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: ONE_KINDS.map(k => one(total, k).adoption_pct) },
    { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: ONE_KINDS.map(k => one(total, k).activity_pct) },
  ];
  const groupSeries = [
    { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: groups.map(g => kindOf(g, kind).adoption_pct) },
    { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: groups.map(g => kindOf(g, kind).activity_pct) },
  ];

  return (
    <div className="space-y-5">
      <MasdBaseline report={report} />
      <KpiRow count={4}>
        <MasdLevelKpis report={report} split={split} level3 />
      </KpiRow>
      <MasdLevelsExplainer report={report} />

      {example && (
        <Section icon={<Calculator />} title={t('expected.workedTitle')} subtitle={t('expected.workedSub')}>
          {exampleText.length > 0 && (
            <div className="rounded-xl bg-surface-sunken p-4 text-sm leading-relaxed text-ink">
              <span className="font-semibold">{t('expected.exampleLead')}</span>{' '}
              {exampleText.join(' | ')}{' '}
              <span className="font-semibold">= {t('expected.exampleTotal', { n: example.expected.community.total })}</span>
            </div>
          )}
          {sameClock ? (
            namedBatches.length > 0 && <p className="mt-3 text-sm text-ink-muted">{t('expected.sameClock', { n: namedBatches.length })}</p>
          ) : (
            <>
              <h4 className="mb-1 mt-5 text-sm font-semibold text-ink">{t('expected.byBatch')}</h4>
              <p className="mb-2 text-sm text-ink-muted">{t('expected.byBatchSub')}</p>
              <DataTable>
                <thead>
                  <tr>
                    <Th className="text-left">{t('expected.batch')}</Th>
                    <Th>{t('expected.trainingEnded')}</Th>
                    <Th>{t('table.learners')}</Th>
                    <Th>{t('expected.fuByTranche')}</Th>
                    <Th>{t('expected.perLearner')}</Th>
                    <Th>{t('expected.nurse')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {cal.batches.map(b => (
                    <tr key={b.id ?? 'project'}>
                      <td className="px-3 py-2 font-medium text-ink">{b.name ?? t('expected.projectDate')}</td>
                      <td className="px-3 py-2 text-center text-ink-muted">{fmtDate(b.end_date)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{b.learners}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{b.tranche_fu.join(' · ') || '—'}</td>
                      <td className="px-3 py-2 text-center font-bold tabular-nums">{b.expected.community.total}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{b.expected.nurse.total}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </>
          )}
        </Section>
      )}

      <MasdUptake report={report} split={split} />

      <Section icon={<Target />} title={<>{t('expected.typeTitle')}<ScopeBadge split={split} /></>} subtitle={t('expected.typeSub')}>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
          <div className="xl:col-span-3">
            <GroupedColumns
              categories={ONE_KINDS.map(k => ({ key: k, label: t(`expected.kind.${k}`),
                sub: t('expected.typeN', { adopted: one(total, k).adopted, target: one(total, k).target }) }))}
              series={typeSeries}
              reference={{ value: 100, label: t('activity.targetLine') }}
              references={averageLines(typeSeries, [total.fulfilment_pct, total.intensity_pct], x => t('activity.avgLine', { what: x.label }))}
              valueSuffix="%"
            />
          </div>
          <div className="xl:col-span-2">
            <MasdFindings findings={report.insights.by_type} />
          </div>
        </div>
      </Section>

      <Section
        icon={<ChartColumn />}
        title={<>{t('expected.byGroupTitle', { type: t(`expected.kind.${kind}`), what: word })}<ScopeBadge split={split} splits /></>}
        subtitle={t('expected.byGroupSub')}
      >
        <div className="mb-4">
          <ChipRow label={t('expected.typeLabel')} value={kind} onChange={v => setKind(v as Kind)}
            items={KINDS.map(k => ({ key: k, label: t(`expected.kind.${k}`) }))} />
        </div>
        <GroupedColumns
          categories={groups.map(g => ({ key: g.key, label: g.label, sub: `n=${g.learners}` }))}
          series={groupSeries}
          reference={{ value: 100, label: t('activity.targetLine') }}
          references={averageLines(groupSeries, [kindOf(total, kind).adoption_pct, kindOf(total, kind).activity_pct], x => t('activity.avgLine', { what: x.label }))}
          valueSuffix="%"
        />
        {best && worst && best.key !== worst.key && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-success-50 px-3 py-1 font-medium text-success-600 dark:bg-success-500/15">
              {t('expected.best2', { name: best.label, pct: fmt1(kindOf(best, kind).activity_pct) })}
            </span>
            <span className="rounded-full bg-error-50 px-3 py-1 font-medium text-error-600 dark:bg-error-500/15">
              {t('expected.worst2', { name: worst.label, pct: fmt1(kindOf(worst, kind).activity_pct) })}
            </span>
          </div>
        )}
        <h4 className="mb-2 mt-6 flex items-center gap-2 text-base font-bold text-ink"><ChartScatter className="size-4" />{t('expected.bubbleTitle')}</h4>
        <BubblePlot
          bubbles={groups.filter(g => kindOf(g, kind).adoption_pct != null && kindOf(g, kind).activity_pct != null).map(g => ({
            key: g.key, label: g.label, x: kindOf(g, kind).adoption_pct!, y: kindOf(g, kind).activity_pct!, size: g.learners,
          }))}
          xLabel={t('activity.bubbleX')}
          yLabel={t('activity.bubbleY')}
          quadrant={{
            topRight: t('activity.qTopRight'), topLeft: t('activity.qTopLeft'),
            bottomRight: t('activity.qBottomRight'), bottomLeft: t('activity.qBottomLeft'),
          }}
          sizeLabel={n => t('activity.learnersN', { count: n })}
        />
        <DataTable className="mt-5">
          <thead>
            <tr>
              <Th className="text-left">{word}</Th>
              <Th>{t('table.learners')}</Th>
              <Th title={t('expected.adopted')}>{t('table.fulfilment')}</Th>
              <Th title={t('expected.done')}>{t('table.intensity')}</Th>
            </tr>
          </thead>
          <tbody>
            {[...groups, total].map(g => {
              const v = kindOf(g, kind);
              return (
                <tr key={g.key} className={g === total ? 'bg-surface-sunken/50 font-semibold' : undefined}>
                  <td className="px-3 py-2 font-medium text-ink">
                    {g.label}
                    {g.key === best?.key && <span className="ml-1 text-success-600">▲</span>}
                    {g.key === worst?.key && <span className="ml-1 text-error-600">▼</span>}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{g.learners}</td>
                  <RateCell value={v.adoption_pct} sub={`${v.adopted} / ${v.target}`} />
                  <RateCell value={v.activity_pct} sub={`${v.actual.toLocaleString()} / ${v.expected.toLocaleString()}`} />
                </tr>
              );
            })}
          </tbody>
        </DataTable>
        <RateLegend className="mt-3" />
      </Section>

      <Section icon={<Layers3 />} title={<>{t('expected.ownTitle')}<ScopeBadge split={split} splits /></>} subtitle={t('expected.ownSub')}>
        <div className="space-y-3">
          {bandGroups.map(g => (
            <div key={g.key} className="grid grid-cols-1 gap-2 lg:grid-cols-[17rem_minmax(0,32rem)] lg:items-center [&>*]:min-w-0">
              <div className="text-sm">
                <span className="font-semibold text-ink">{g.label}</span>
                <span className="ml-1.5 text-xs text-ink-faint">{t('expected.ownN', { n: g.banded, pct: fmt1(g.pct) })}</span>
              </div>
              <StackedBar height="h-5" showLegend={false} divided
                parts={OWN_BANDS.map(b => ({ key: b, label: t(`bandsOwn.${b}`), value: g.bands[b], color: BAND_COLORS[b] }))} />
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {OWN_BANDS.map(b => (
            <span key={b} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="size-2.5 rounded-full" style={{ background: BAND_COLORS[b] }} aria-hidden />{t(`bandsOwn.${b}`)}
            </span>
          ))}
        </div>
        <DataTable className="mt-5">
          <thead>
            <tr>
              <Th className="text-left">{word}</Th>
              <Th>{t('expected.banded')}</Th>
              {OWN_BANDS.map(b => <Th key={b}>{t(`bandsOwn.${b}`)}</Th>)}
              <Th>{t('expected.ownPct')}</Th>
            </tr>
          </thead>
          <tbody>
            {bandGroups.map(g => (
              <tr key={g.key} className={g.key === 'total' ? 'bg-surface-sunken/50 font-semibold' : undefined}>
                <td className="px-3 py-2 font-medium text-ink">{g.label}</td>
                <td className="px-3 py-2 text-center tabular-nums">{g.banded}</td>
                {OWN_BANDS.map(b => (
                  <td key={b} className="px-3 py-2 text-center tabular-nums">
                    {g.banded ? `${Math.round((100 * g.bands[b]) / g.banded)}%` : '—'}
                    <span className="ml-1 text-xs font-normal text-ink-faint">({g.bands[b]})</span>
                  </td>
                ))}
                <RateCell value={g.pct} />
              </tr>
            ))}
          </tbody>
        </DataTable>
        {!Object.values(split.filters).some(v => v?.length) && <MasdFindings className="mt-5" findings={report.insights.own_cases} />}
      </Section>

      <Section icon={<ListChecks />} title={t('expected.howTitle')}>
        <ul className="space-y-1.5 text-sm text-ink-muted">
          <li className="flex gap-2"><Timer className="mt-0.5 size-4 shrink-0 text-ink-faint" />{t('expected.how1', {
            first: report.rules.expected.buffer_days, later: report.rules.expected.later_buffer_days, step: cal.step_days,
          })}</li>
          <li className="flex gap-2"><Target className="mt-0.5 size-4 shrink-0 text-ink-faint" />{t('expected.how2')}</li>
          <li className="flex gap-2"><Layers3 className="mt-0.5 size-4 shrink-0 text-ink-faint" />{t('expected.how3')}</li>
        </ul>
      </Section>
    </div>
  );
};

export default MasdExpected;
