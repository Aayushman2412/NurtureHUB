import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, ChartColumn, Stethoscope, TrendingDown, TrendingUp } from 'lucide-react';
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
  const basis = (n: number) => (n === 1 ? t('progress.basisT1') : t('progress.basisBoth'));
  const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);

  const rows: [string, React.ReactNode, React.ReactNode, React.ReactNode][] = [
    [t('progress.basis'), basis(then.tranches_in_force), basis(now.tranches_in_force), null],
    [t('progress.learners'), then.learners, now.learners, null],
    [t('progress.targetBasis'), t('progress.perLearner', { n: then.target_per_learner }), t('progress.perLearner', { n: now.target_per_learner }), null],
    [t('progress.adoptions'),
      `${then.adoptions.toLocaleString()} (${fmt1(then.fulfilment_pct)})`,
      `${now.adoptions.toLocaleString()} (${fmt1(now.fulfilment_pct)})`,
      <Change key="f" value={diff(then.fulfilment_pct, now.fulfilment_pct)} />],
    [t('progress.intensity'), fmt1(then.intensity_pct), fmt1(now.intensity_pct),
      <Change key="i" value={diff(then.intensity_pct, now.intensity_pct)} />],
    [t('progress.nilDays'), fmt1(then.nil_days_avg, ''), fmt1(now.nil_days_avg, ''),
      <Change key="n" value={diff(then.nil_days_avg, now.nil_days_avg)} unit={t('progress.days')} lowerIsBetter />],
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        {([['fulfilment', 'progress.byBlockAdoption'], ['intensity', 'progress.byBlockIntensity']] as const).map(([key, title]) => (
          <Section key={key} icon={<ChartColumn />} title={t(title)}>
            <GroupedColumns
              categories={blockCats}
              series={[
                { key: 'then', label: thenLabel, color: MASD_COLORS.then, values: cmp.blocks.map(b => b[`${key}_then`]) },
                { key: 'now', label: nowLabel, color: key === 'fulfilment' ? MASD_COLORS.adoption : MASD_COLORS.activity,
                  values: cmp.blocks.map(b => b[`${key}_now`]) },
              ]}
              reference={{ value: 100, label: t('activity.targetLine') }}
              valueSuffix="%"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {cmp.blocks.map(b => (
                <span key={b.key} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-sunken px-2 py-1 text-xs text-ink-muted">
                  {b.label} <Change value={b[`${key}_change`]} />
                </span>
              ))}
            </div>
          </Section>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
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
        <Section icon={<TrendingDown />} title={t('progress.uwTitle')} subtitle={t('progress.uwSub')}>
          <DataTable>
            <thead>
              <tr><Th className="text-left">{t('progress.band')}</Th><Th>{t('progress.report')}</Th><Th>n</Th><Th>AV</Th><Th>LV</Th><Th>{t('progress.change')}</Th></tr>
            </thead>
            <tbody>
              {(['lt6', 'm6_11'] as const).flatMap(band => [then, now].map((snap, i) => {
                const u = snap.underweight[band];
                return (
                  <tr key={`${band}-${i}`}>
                    <td className="px-3 py-2 font-medium">{i === 0 ? t(`bands.${band}`) : ''}</td>
                    <td className="px-3 py-2 text-center text-ink-muted">{i === 0 ? t('progress.interim') : t('progress.final')} · {fmtDate(snap.as_of)}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{u.n}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{fmt1(u.av)}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{fmt1(u.lv)}</td>
                    <td className="px-3 py-2 text-center"><Change value={u.abs_change} lowerIsBetter /></td>
                  </tr>
                );
              }))}
            </tbody>
          </DataTable>
        </Section>
      </div>
    </div>
  );
};

export default MasdProgress;
