import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartColumn, ChartScatter, GitCompareArrows, Layers, Scale, Table2 } from 'lucide-react';
import { ACTIVITY_KEYS, type ActivityKey, type MasdGroup, type MasdReport } from '../../api/masd';
import { Section } from '../results/InsightParts';
import MasdFindings from './MasdFindings';
import { BubblePlot, DataTable, GroupedColumns, RateCell, Th } from './MasdCharts';
import { averageLines, fmt1, MASD_COLORS } from '../../lib/masdDisplay';
import { aggregate, applyFilters, pct, splitBy, type MasdAgg, type TypeAgg } from '../../lib/masdSplit';
import type { MasdSplitState } from './MasdSplitBar';
import RateLegend from './RateLegend';

const WCD_ROLES = ['AWW', 'AWSup'];

/** The three visit-vs-intervention pairs (review of 7 Oct 2026). */
const PAIRS: { key: string; x: ActivityKey; y: ActivityKey; pick: (g: MasdAgg) => TypeAgg[] }[] = [
  { key: 'lt5', x: 'gm', y: 'bf', pick: g => [g.by_type.pnc_lt5, g.nurse_lt5] },
  { key: 'ge5', x: 'gm', y: 'cf', pick: g => [g.by_type.pnc_ge5] },
  { key: 'anc', x: 'anc', y: 'protein', pick: g => [g.by_type.anc] },
];

const pairRates = (g: MasdAgg, p: (typeof PAIRS)[number]) => {
  const parts = p.pick(g);
  const sum = (f: (t: TypeAgg) => number) => parts.reduce((a, t) => a + f(t), 0);
  return {
    x: pct(sum(t => t.actual_by[p.x]), sum(t => t.expected_by[p.x])),
    y: pct(sum(t => t.actual_by[p.y]), sum(t => t.expected_by[p.y])),
    xDone: sum(t => t.actual_by[p.x]), xDue: sum(t => t.expected_by[p.x]),
    yDone: sum(t => t.actual_by[p.y]), yDue: sum(t => t.expected_by[p.y]),
    adopted: sum(t => t.adopted),
  };
};

const MasdActivity: React.FC<{ report: MasdReport; split: MasdSplitState }> = ({ report, split }) => {
  const { t } = useTranslation('masd');
  const learners = useMemo(() => applyFilters(report.learners.filter(l => l.f2f), split.filters), [report.learners, split.filters]);
  const groups = useMemo(() => splitBy(learners, split.dim), [learners, split.dim]);
  const total = useMemo(() => aggregate(learners, 'total', t('table.total')), [learners, t]);
  const word = t(`splitDims.${split.dim}`);
  const categories = groups.map(g => ({ key: g.key, label: g.label, sub: `n=${g.learners}` }));
  const filtered = Object.values(split.filters).some(v => v?.length);

  const mainSeries = [
    { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: groups.map(g => g.fulfilment_pct) },
    { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: groups.map(g => g.intensity_pct) },
  ];
  const subtypeSeries = ACTIVITY_KEYS.map(k => ({
    key: k, label: t(`activities.${k}`), color: MASD_COLORS[k], values: groups.map(g => g.subtype_pct[k]),
  }));

  return (
    <div className="space-y-5">
      <Section icon={<ChartColumn />} title={t('activity.fulfilTitle', { what: word })} subtitle={t('activity.fulfilSub')}>
        <GroupedColumns
          categories={categories}
          series={mainSeries}
          reference={{ value: 100, label: t('activity.targetLine') }}
          references={averageLines(mainSeries, [total.fulfilment_pct, total.intensity_pct], s => t('activity.avgLine', { what: s.label }))}
          valueSuffix="%"
        />
        {!filtered && split.dim === 'block' && <MasdFindings className="mt-5" findings={report.insights.blocks} />}
        {!filtered && split.dim === 'role_group' && <MasdFindings className="mt-5" findings={report.insights.roles} />}
      </Section>

      <Section icon={<ChartScatter />} title={t('activity.bubbleTitle', { what: word })} subtitle={t('activity.bubbleSub')}>
        <BubblePlot
          bubbles={groups.filter(g => g.fulfilment_pct != null && g.intensity_pct != null).map(g => ({
            key: g.key, label: g.label, x: g.fulfilment_pct!, y: g.intensity_pct!, size: g.learners,
          }))}
          xLabel={t('activity.bubbleX')}
          yLabel={t('activity.bubbleY')}
          quadrant={{
            topRight: t('activity.qTopRight'), topLeft: t('activity.qTopLeft'),
            bottomRight: t('activity.qBottomRight'), bottomLeft: t('activity.qBottomLeft'),
          }}
          sizeLabel={n => t('activity.learnersN', { count: n })}
        />
      </Section>

      <Section icon={<Table2 />} title={t('activity.dataTitle')} subtitle={t('activity.dataSub')}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{word}</Th>
              <Th>{t('table.learners')}</Th>
              <Th>{t('activity.adoptTarget')}</Th>
              <Th>{t('activity.actual')}</Th>
              <Th>{t('table.fulfilment')}</Th>
              <Th>{t('activity.actExpected')}</Th>
              <Th>{t('activity.actual')}</Th>
              <Th>{t('table.intensity')}</Th>
              <Th title={t('activity.undertakenTitle')}>{t('activity.undertaken')}</Th>
              <Th>{t('table.nilMedian')}</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => <AggRow key={g.key} g={g} />)}
            <AggRow g={total} bold />
          </tbody>
        </DataTable>
        <RateLegend className="mt-3" />
      </Section>

      <Section icon={<GitCompareArrows />} title={t('activity.pairsTitle', { what: word })} subtitle={t('activity.pairsSub')}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 [&>*]:min-w-0">
          {PAIRS.map(p => {
            const all = pairRates(total, p);
            return (
              <div key={p.key}>
                <h4 className="text-sm font-semibold text-ink">{t(`activity.pair.${p.key}`)}</h4>
                <p className="mb-2 text-xs text-ink-muted">
                  {t('activity.pairAll', {
                    x: t(`activities.${p.x}`), xv: fmt1(all.x), xd: all.xDone.toLocaleString(), xe: all.xDue.toLocaleString(),
                    y: t(`activities.${p.y}`), yv: fmt1(all.y), yd: all.yDone.toLocaleString(), ye: all.yDue.toLocaleString(),
                  })}
                </p>
                <BubblePlot
                  bubbles={groups.map(g => ({ g, r: pairRates(g, p) }))
                    .filter(({ r }) => r.x != null && r.y != null)
                    .map(({ g, r }) => ({ key: g.key, label: g.label, x: r.x!, y: r.y!, size: Math.max(1, r.adopted) }))}
                  xLabel={t('activity.pairX', { what: t(`activities.${p.x}`) })}
                  yLabel={t('activity.pairY', { what: t(`activities.${p.y}`) })}
                  quadrant={{ topRight: t('activity.pq.tr'), topLeft: t('activity.pq.tl'), bottomRight: t('activity.pq.br'), bottomLeft: t('activity.pq.bl') }}
                  sizeLabel={n => t('activity.casesN', { count: n })}
                  diagonal={t('activity.pairDiagonal')}
                />
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-muted">{t('activity.pairsNote')}</p>
      </Section>

      <Section icon={<Layers />} title={t('activity.subtypeTitle', { what: word })} subtitle={t('activity.subtypeSub')}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{word}</Th>
              <Th>{t('table.learners')}</Th>
              {ACTIVITY_KEYS.map(k => <Th key={k}>{t(`activities.${k}`)}</Th>)}
              <Th>{t('activity.allActivities')}</Th>
            </tr>
          </thead>
          <tbody>
            {[...groups, total].map(g => (
              <tr key={g.key} className={g === total ? 'bg-surface-sunken/50 font-semibold' : undefined}>
                <td className="px-3 py-2 font-medium text-ink">{g.label}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{g.learners}</td>
                {ACTIVITY_KEYS.map(k => (
                  <RateCell key={k} value={g.subtype_pct[k]}
                    sub={`${g.subtype_actual[k].toLocaleString()} / ${Math.round(g.subtype_ideal[k]).toLocaleString()}`} />
                ))}
                <RateCell value={g.intensity_pct} sub={`${g.activities.toLocaleString()} / ${Math.round(g.ideal).toLocaleString()}`} />
              </tr>
            ))}
          </tbody>
        </DataTable>
        <RateLegend className="mt-3" />
        <div className="mt-5">
          <GroupedColumns
            categories={categories}
            series={subtypeSeries}
            reference={{ value: 100, label: t('activity.idealLine') }}
            references={averageLines(subtypeSeries, ACTIVITY_KEYS.map(k => total.subtype_pct[k]), s => t('activity.avgLine', { what: s.label }))}
            valueSuffix="%"
          />
        </div>
        {!filtered && <MasdFindings className="mt-5" findings={report.insights.subtypes} />}
      </Section>

      {split.dim === 'role_group' && !filtered && (
        <Section icon={<Scale />} title={t('activity.targetsTitle')} subtitle={t('activity.targetsSub')}>
          <DataTable>
            <thead>
              <tr>
                <Th className="text-left">{t('table.cadre')}</Th>
                <Th>{t('table.learners')}</Th>
                <Th>{t('activity.adoptTarget')}</Th>
                <Th>{t('activity.actual')}</Th>
                <Th>{t('table.fulfilment')}</Th>
                <Th>{t('activity.actExpected')}</Th>
                <Th>{t('activity.actual')}</Th>
                <Th>{t('table.intensity')}</Th>
              </tr>
            </thead>
            <tbody>
              {(['WCD', 'HFW'] as const).flatMap(dept => {
                const members = report.roles.filter(g => g.learners > 0 && (dept === 'WCD') === WCD_ROLES.includes(g.key));
                const sub = report.departments.find(d => d.key === dept);
                return [
                  ...members.map(g => <TargetRow key={g.key} g={g} />),
                  ...(sub && sub.learners ? [<TargetRow key={`sub-${dept}`} g={{ ...sub, label: t(`activity.subtotal${dept}`) }} bold />] : []),
                ];
              })}
              <TargetRow g={{ ...report.departments[report.departments.length - 1], label: t('activity.grandTotal') }} bold />
            </tbody>
          </DataTable>
        </Section>
      )}
    </div>
  );
};

const AggRow: React.FC<{ g: MasdAgg; bold?: boolean }> = ({ g, bold }) => (
  <tr className={bold ? 'bg-surface-sunken/50 font-semibold' : undefined}>
    <td className="px-3 py-2 text-ink">{g.label}</td>
    <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{g.learners}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.target.toLocaleString()}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.adoptions.toLocaleString()}</td>
    <RateCell value={g.fulfilment_pct} />
    <td className="px-3 py-2 text-center tabular-nums">{Math.round(g.ideal).toLocaleString()}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.activities.toLocaleString()}</td>
    <RateCell value={g.intensity_pct} />
    <RateCell value={g.undertaken_pct} sub={`${g.undertaken_actual.toLocaleString()} / ${g.undertaken_expected.toLocaleString()}`} />
    <td className="px-3 py-2 text-center tabular-nums">
      {g.nil.median == null ? '—' : <>{g.nil.median} <span className="text-xs text-ink-faint">({g.nil.q1}–{g.nil.q3})</span></>}
    </td>
  </tr>
);

const TargetRow: React.FC<{ g: MasdGroup; bold?: boolean }> = ({ g, bold }) => (
  <tr className={bold ? 'bg-surface-sunken/50 font-semibold' : undefined}>
    <td className="px-3 py-2 text-ink">{g.label}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.learners}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.target.toLocaleString()}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.adoptions.toLocaleString()}</td>
    <RateCell value={g.fulfilment_pct} />
    <td className="px-3 py-2 text-center tabular-nums">{Math.round(g.ideal).toLocaleString()}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.activities.toLocaleString()}</td>
    <RateCell value={g.intensity_pct} />
  </tr>
);

export default MasdActivity;
