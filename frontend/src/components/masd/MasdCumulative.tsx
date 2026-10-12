import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, ChartColumn, TrendingUp } from 'lucide-react';
import { getMasdCumulative, type CumulativeDay, type CumulativeKind, type CumulativeSeries, type MasdReport } from '../../api/masd';
import { ChipRow, Section } from '../results/InsightParts';
import { CumulativeChart, GroupedColumns } from './MasdCharts';
import { byGrain, fmt1, MASD_COLORS } from '../../lib/masdDisplay';
import { filteredIds, pct, type MasdSplitState } from '../../lib/masdSplit';
import ScopeBadge from './ScopeBadge';

type Mode = 'day' | 'week' | 'month' | 'tranche' | 'custom';
type KindChoice = 'all' | CumulativeKind;
const KINDS: KindChoice[] = ['all', 'anc', 'pnc_lt5', 'pnc_ge5', 'sn'];
/** Days into a tranche by which activity should already show (review of 12 Oct 2026). */
const EARLY_DAYS = 6;

const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** The last day of each bar's period, and its label. */
function buckets(days: CumulativeDay[], mode: Mode, perBar: number, series: CumulativeSeries | null) {
  if (!days.length) return [];
  if (mode === 'week' || mode === 'month') {
    return byGrain(days, mode).map(d => ({ d, label: mode === 'month' ? monthLabel(d.date) : short(d.date) }));
  }
  if (mode === 'tranche') {
    const clocks = (series?.tranches ?? []).map(tr => tr.clock_from).filter((c): c is string => !!c);
    const out: { d: CumulativeDay; label: string }[] = [];
    clocks.forEach((c, i) => {
      const next = clocks[i + 1];
      const inside = days.filter(x => x.date >= c && (!next || x.date < next));
      if (inside.length) out.push({ d: inside[inside.length - 1], label: `T${i + 1}` });
    });
    return out;
  }
  const n = mode === 'day' ? 1 : perBar;
  const out: { d: CumulativeDay; label: string }[] = [];
  for (let i = days.length - 1; i >= 0; i -= n) out.unshift({ d: days[i], label: short(days[i].date) });
  return out;
}

/**
 * Where the project should be by each date, and where it is (reviews of 6
 * and 12 Oct 2026). A tranche's adoptions are all expected the day its buffer
 * ends, so the expected line rises straight up there; its forms then fall due
 * day by day on the LAP schedule. A third line counts what the cases actually
 * adopted were due, each by its own dates. Below, the same as % fulfilled —
 * any number of days per bar — and a warning when activity keeps slipping.
 */
const MasdCumulative: React.FC<{ report: MasdReport; split: MasdSplitState; asOf?: string }> = ({ report, split, asOf }) => {
  const { t } = useTranslation('masd');
  const [kind, setKind] = useState<KindChoice>('all');
  const [mode, setMode] = useState<Mode>('week');
  const [perBar, setPerBar] = useState(7);
  const [series, setSeries] = useState<CumulativeSeries | null>(report.cumulative ?? null);
  const [loading, setLoading] = useState(false);
  const ids = useMemo(() => filteredIds(report.learners.filter(l => l.f2f), split.filters), [report.learners, split.filters]);
  const idsKey = ids ? ids.join(',') : 'all';

  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      getMasdCumulative(report.project.slug, {
        as_of: asOf ?? report.as_of, learner_ids: ids, kind: kind === 'all' ? null : kind, per_case: true,
      })
        .then(s => { if (live) setSeries(s); })
        .catch(() => { /* keep what is shown */ })
        .finally(() => { if (live) setLoading(false); });
    }, 300);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.project.slug, report.as_of, asOf, idsKey, kind]);

  const days = useMemo(() => series?.days ?? [], [series]);
  const points = useMemo(() => buckets(days, mode, perBar, series), [days, mode, perBar, series]);
  const hasCases = days.some(d => d.expected_cases != null);

  // Activity slipping: the share of expected forms done fell on each of the
  // last few days — the moment to call, not two weeks later.
  const warning = useMemo(() => {
    const rate = days.map(d => pct(d.activities, d.expected_activities));
    let run = 0;
    for (let i = rate.length - 1; i > 0; i--) {
      const a = rate[i], b = rate[i - 1];
      if (a == null || b == null || a >= b) break;
      run += 1;
    }
    return run >= 3 ? { days: run, from: rate[rate.length - 1 - run], to: rate[rate.length - 1] } : null;
  }, [days]);

  // How each tranche began: forms due in its first days against forms done.
  const early = useMemo(() => (series?.tranches ?? []).flatMap(tr => {
    if (!tr.clock_from) return [];
    const i = days.findIndex(d => d.date >= tr.clock_from!);
    if (i < 0) return [];
    const j = Math.min(days.length - 1, i + EARLY_DAYS - 1);
    const before = i > 0 ? days[i - 1] : { expected_activities: 0, activities: 0, expected_cases: 0 };
    const due = days[j].expected_activities - before.expected_activities;
    const done = days[j].activities - before.activities;
    return [{ step: tr.step, from: tr.clock_from, days: j - i + 1, due, done, pct: pct(done, due) }];
  }), [series, days]);

  if (!days.length && !loading) return null;
  const labels = points.map(p => p.label);
  const title = (
    <>{t('cumulative.title')}<ScopeBadge split={split} /></>
  );

  return (
    <Section icon={<TrendingUp />} title={title} subtitle={t('cumulative.sub2')}>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <ChipRow label={t('cumulative.kind')} value={kind} onChange={v => setKind(v as KindChoice)}
          items={KINDS.map(k => ({ key: k, label: t(`cumulative.kinds.${k}`) }))} />
        <ChipRow label={t('cumulative.by')} value={mode === 'custom' ? '' : mode} onChange={v => {
          setMode(v as Mode);
          if (v === 'day') setPerBar(1);
          if (v === 'week') setPerBar(7);
          if (v === 'month') setPerBar(30);
        }} items={(['day', 'week', 'month', 'tranche'] as Mode[]).map(g => ({ key: g, label: t(`cumulative.grain.${g}`) }))} />
        <label className="flex items-center gap-2 text-sm text-ink">
          <span className="font-semibold text-ink-muted">{t('cumulative.perBar', { count: perBar })}</span>
          <input type="range" min={1} max={30} value={perBar} aria-label={t('cumulative.perBarLabel')}
            onChange={e => { setPerBar(Number(e.target.value)); setMode('custom'); }} className="w-40 accent-(--primary)" />
        </label>
        {loading && <span className="text-xs text-ink-muted">{t('updating')}</span>}
      </div>

      {warning && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
          <BellRing className="mt-0.5 size-4 shrink-0" />
          {t('cumulative.slipping', { n: warning.days, from: fmt1(warning.from), to: fmt1(warning.to) })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <div>
          <h4 className="mb-1 text-base font-bold text-ink">{t('cumulative.adoptions')}</h4>
          <CumulativeChart labels={labels} lines={[
            { key: 'exp', label: t('cumulative.expectedAdoptions'), color: MASD_COLORS.adoption, dashed: true, step: true,
              values: points.map(p => p.d.expected_adoptions) },
            { key: 'act', label: t('cumulative.actual'), color: '#1F5560', values: points.map(p => p.d.adoptions) },
          ]} />
        </div>
        <div>
          <h4 className="mb-1 text-base font-bold text-ink">{t('cumulative.activities')}</h4>
          <CumulativeChart labels={labels} lines={[
            { key: 'exp', label: t('cumulative.expectedIdeal'), color: MASD_COLORS.activity, dashed: true, step: true,
              values: points.map(p => p.d.expected_activities) },
            ...(hasCases ? [{ key: 'cases', label: t('cumulative.expectedCases'), color: '#7C5CBF', dotted: true, step: true,
              values: points.map(p => p.d.expected_cases ?? 0) }] : []),
            { key: 'act', label: t('cumulative.actual'), color: '#A23B2E', values: points.map(p => p.d.activities) },
          ]} />
        </div>
      </div>

      <h4 className="mb-1 mt-6 flex items-center gap-2 text-base font-bold text-ink"><ChartColumn className="size-4" />{t('cumulative.pctTitle')}</h4>
      <p className="mb-2 text-sm text-ink-muted">{t('cumulative.pctSub')}</p>
      <GroupedColumns
        categories={points.map(p => ({ key: p.d.date, label: p.label }))}
        series={[
          { key: 'a', label: t('cumulative.pctAdoption'), color: MASD_COLORS.adoption, values: points.map(p => pct(p.d.adoptions, p.d.expected_adoptions)) },
          { key: 'x', label: t('cumulative.pctIdeal'), color: MASD_COLORS.activity, values: points.map(p => pct(p.d.activities, p.d.expected_activities)) },
          ...(hasCases ? [{ key: 'c', label: t('cumulative.pctCases'), color: '#7C5CBF',
            values: points.map(p => pct(p.d.activities, p.d.expected_cases ?? 0)) }] : []),
        ]}
        reference={{ value: 100, label: t('activity.targetLine') }}
        valueSuffix="%"
        height={200}
      />

      {early.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-1 text-base font-bold text-ink">{t('cumulative.earlyTitle', { n: EARLY_DAYS })}</h4>
          <p className="mb-2 text-sm text-ink-muted">{t('cumulative.earlySub')}</p>
          <div className="flex flex-wrap gap-2">
            {early.map(e => (
              <span key={e.step} className={`rounded-lg px-3 py-1.5 text-sm ${(e.pct ?? 0) < 60 ? 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-300' : 'bg-surface-sunken text-ink'}`}>
                <b>{t('expected.tranche', { n: e.step })}</b> · {short(e.from!)} · {t('cumulative.earlyValue', { done: e.done.toLocaleString(), due: e.due.toLocaleString(), pct: fmt1(e.pct) })}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-ink-muted">{t('cumulative.note2')}</p>
    </Section>
  );
};

export default MasdCumulative;
