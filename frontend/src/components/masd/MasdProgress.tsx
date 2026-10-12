import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, ChartColumn, Stethoscope, TrendingDown, TrendingUp } from 'lucide-react';
import type { ComparisonSnapshot } from '../../api/masd';
import type { MasdReport } from '../../api/masd';
import { EmptyState } from '../ui';
import { Section } from '../results/InsightParts';
import { cn } from '../../utils/cn';
import MasdFindings from './MasdFindings';
import { DataTable, GroupedColumns, Th } from './MasdCharts';
import { fmt1, MASD_COLORS } from '../../lib/masdDisplay';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

const Change: React.FC<{ value: number | null; unit?: string; lowerIsBetter?: boolean }> = ({ value, unit = ' pts', lowerIsBetter }) => {
  if (value == null) return <span className="text-ink-faint">—</span>;
  const good = lowerIsBetter ? value < 0 : value > 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
      Math.abs(value) < 1 ? 'bg-surface-sunken text-ink-muted'
        : good ? 'bg-success-50 text-success-600 dark:bg-success-500/15' : 'bg-error-50 text-error-600 dark:bg-error-500/15',
    )}>
      {value > 0 ? <TrendingUp className="size-3" /> : value < 0 ? <TrendingDown className="size-3" /> : null}
      {value > 0 ? '+' : ''}{value.toFixed(1)}{unit}
    </span>
  );
};

const MasdProgress: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const cmp = report.comparison;
  if (!cmp) {
    return (
      <EmptyState
        icon={<CalendarRange className="size-8" />}
        title={t('progress.noneTitle')}
        description={t('progress.none')}
      />
    );
  }
  const { then, now } = cmp;
  const thenLabel = fmtDate(then.as_of);
  const nowLabel = fmtDate(now.as_of);
  const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);

  const countPct = (n: number | undefined, of: number | undefined, p: number | null | undefined) =>
    (n == null || of == null ? fmt1(p ?? null) : t('progress.countOf', { n: n.toLocaleString(), of: Math.round(of).toLocaleString(), pct: fmt1(p ?? null) }));
  const nil = (x: ComparisonSnapshot) => (x.nil_days_median == null
    ? fmt1(x.nil_days_avg, '')
    : t('progress.medianIqr', { m: x.nil_days_median, q1: x.nil_days_q1, q3: x.nil_days_q3 }));
  const rows: [string, React.ReactNode, React.ReactNode, React.ReactNode][] = [
    [t('progress.basis'), t('progress.fuDays', { n: then.fu_days ?? 0 }), t('progress.fuDays', { n: now.fu_days ?? 0 }), null],
    [t('progress.learners'), then.learners, now.learners, null],
    [t('progress.targetBasis'),
      t('progress.perLearnerTotal', { n: then.target_per_learner, total: then.target.toLocaleString() }),
      t('progress.perLearnerTotal', { n: now.target_per_learner, total: now.target.toLocaleString() }), null],
    [t('progress.adoptions'),
      countPct(then.adoptions, then.target, then.fulfilment_pct),
      countPct(now.adoptions, now.target, now.fulfilment_pct),
      <Change key="f" value={diff(then.fulfilment_pct, now.fulfilment_pct)} />],
    [t('progress.intensity'),
      countPct(then.activities, then.ideal, then.intensity_pct),
      countPct(now.activities, now.ideal, now.intensity_pct),
      <Change key="i" value={diff(then.intensity_pct, now.intensity_pct)} />],
    [t('progress.undertaken'),
      countPct(then.undertaken_actual, then.undertaken_expected, then.undertaken_pct ?? then.own_pct),
      countPct(now.undertaken_actual, now.undertaken_expected, now.undertaken_pct ?? now.own_pct),
      <Change key="o" value={diff(then.undertaken_pct ?? then.own_pct, now.undertaken_pct ?? now.own_pct)} />],
    [t('progress.nilMedian'), nil(then), nil(now),
      <Change key="n" value={diff(then.nil_days_median ?? then.nil_days_avg, now.nil_days_median ?? now.nil_days_avg)} unit={t('progress.days')} lowerIsBetter />],
    [t('progress.cohort'),
      t('progress.cohortN', { n: then.cohort, a: then.cohort_lt6, b: then.cohort_6_11 }),
      t('progress.cohortN', { n: now.cohort, a: now.cohort_lt6, b: now.cohort_6_11 }), null],
  ];

  const blockCats = cmp.blocks.map(b => ({ key: b.key, label: b.label }));

  return (
    <div className="space-y-5">
      <Section icon={<CalendarRange />} title={t('progress.title', { then: thenLabel, now: nowLabel })} subtitle={t('progress.sub')}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{t('progress.metric')}</Th>
              <Th>{thenLabel}</Th>
              <Th>{nowLabel}</Th>
              <Th>{t('progress.change')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b, c]) => (
              <tr key={label}>
                <td className="px-3 py-2 font-medium text-ink">{label}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{a}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink">{b}</td>
                <td className="px-3 py-2 text-center">{c}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <MasdFindings className="mt-5" findings={report.insights.progress} />
      </Section>

      <Section icon={<ChartColumn />} title={t('progress.byBlockBoth')} subtitle={t('progress.byBlockBothSub')}>
        <GroupedColumns
          categories={blockCats}
          series={[
            { key: 'ft', label: t('progress.seriesThen', { what: t('activity.adoptionPct'), date: thenLabel }), color: '#9FC5CC', values: cmp.blocks.map(b => b.fulfilment_then) },
            { key: 'fn', label: t('progress.seriesNow', { what: t('activity.adoptionPct'), date: nowLabel }), color: MASD_COLORS.adoption, values: cmp.blocks.map(b => b.fulfilment_now) },
            { key: 'it', label: t('progress.seriesThen', { what: t('activity.activityPct'), date: thenLabel }), color: '#F2B8AE', values: cmp.blocks.map(b => b.intensity_then) },
            { key: 'in', label: t('progress.seriesNow', { what: t('activity.activityPct'), date: nowLabel }), color: MASD_COLORS.activity, values: cmp.blocks.map(b => b.intensity_now) },
          ]}
          reference={{ value: 100, label: t('activity.targetLine') }}
          valueSuffix="%"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {cmp.blocks.map(b => (
            <span key={b.key} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-sunken px-2 py-1 text-xs text-ink-muted">
              {b.label} <span className="text-ink">{t('progress.adoptShort')}</span> <Change value={b.fulfilment_change} />
              <span className="text-ink">{t('progress.actShort')}</span> <Change value={b.intensity_change} />
            </span>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <p className="self-center text-sm text-ink-muted xl:order-2"><TrendingDown className="mr-1 inline size-4" />{t('progress.uwMoved')}</p>
        {then.nurses && now.nurses && (
          <Section icon={<Stethoscope />} title={t('progress.nursesTitle')} subtitle={t('progress.nursesSub')}>
            <DataTable>
              <thead>
                <tr><Th className="text-left">{t('progress.metric')}</Th><Th>{thenLabel}</Th><Th>{nowLabel}</Th><Th>{t('progress.change')}</Th></tr>
              </thead>
              <tbody>
                <tr><td className="px-3 py-2">{t('progress.learners')}</td><td className="text-center">{then.nurses.learners}</td><td className="text-center">{now.nurses.learners}</td><td /></tr>
                <tr><td className="px-3 py-2">{t('table.fulfilment')}</td><td className="text-center">{fmt1(then.nurses.fulfilment_pct)}</td><td className="text-center">{fmt1(now.nurses.fulfilment_pct)}</td><td className="text-center"><Change value={diff(then.nurses.fulfilment_pct, now.nurses.fulfilment_pct)} /></td></tr>
                <tr><td className="px-3 py-2">{t('table.intensity')}</td><td className="text-center">{fmt1(then.nurses.intensity_pct)}</td><td className="text-center">{fmt1(now.nurses.intensity_pct)}</td><td className="text-center"><Change value={diff(then.nurses.intensity_pct, now.nurses.intensity_pct)} /></td></tr>
                <tr><td className="px-3 py-2">{t('table.nilDays')}</td><td className="text-center">{fmt1(then.nurses.nil_days_avg, '')}</td><td className="text-center">{fmt1(now.nurses.nil_days_avg, '')}</td><td className="text-center"><Change value={diff(then.nurses.nil_days_avg, now.nurses.nil_days_avg)} unit={t('progress.days')} lowerIsBetter /></td></tr>
              </tbody>
            </DataTable>
          </Section>
        )}
      </div>
    </div>
  );
};

export default MasdProgress;
