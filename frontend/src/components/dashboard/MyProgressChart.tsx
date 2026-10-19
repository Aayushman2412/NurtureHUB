import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import type { CumulativeDay, CumulativeSeries } from '../../api/masd';
import { CumulativeChart, GroupedColumns } from '../masd/MasdCharts';
import { MASD_COLORS } from '../../lib/masdDisplay';
import { Card } from '../ui';

const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });
/** The weekday as one letter — M T W T F S S (review of 19 Oct 2026). */
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const isSunday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** One point per bar: the last day of every `n`-day stretch, ending today. */
function everyN(days: CumulativeDay[], n: number) {
  const out: CumulativeDay[] = [];
  for (let i = days.length - 1; i >= 0; i -= n) out.unshift(days[i]!);
  return out;
}

/**
 * My progress, day by day — the learner's own line from the supervisors'
 * cumulative chart (reviews of 12 and 17 Oct 2026): the forms my cases were
 * due by each date (each case by its own dates) against the forms I filled,
 * and the adoptions asked of me against the adoptions I made. The same
 * days-per-bar slider as the MASD dashboard: one day per bar to see each
 * visit, more to see the trend.
 */
const MyProgressChart: React.FC<{ series: CumulativeSeries }> = ({ series }) => {
  const { t } = useTranslation('dashboard');
  const [perBar, setPerBar] = useState(7);
  const points = useMemo(() => everyN(series.days, perBar), [series.days, perBar]);
  if (series.days.length < 2) return null;
  const labels = points.map(p => `${short(p.date)} ${weekday(p.date)}`);
  // Sundays are greyed (review of 19 Oct 2026: "every Sunday you make it into
  // a grey area ... else it appears as though it is a poor activity") — only
  // when each bar is one day; a wider bar spans working days too.
  const shaded = points.map(p => perBar === 1 && isSunday(p.date));
  const hasCases = points.some(p => (p.expected_cases ?? 0) > 0);

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <TrendingUp className="size-5 text-primary-ink" />{t('progress.title')}
      </h3>
      <p className="mb-3 text-sm text-ink-muted">{t('progress.subtitle')}</p>
      <label className="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink">
        <span className="font-semibold text-ink-muted">{t('progress.perBar', { count: perBar })}</span>
        <input
          type="range" min={1} max={30} value={perBar}
          onChange={e => setPerBar(Number(e.target.value))}
          aria-label={t('progress.perBarLabel')} className="w-44 accent-(--primary)"
        />
      </label>

      <p className="mb-4 text-xs text-ink-muted">{t('progress.sundays')}</p>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <div>
          <h4 className="mb-1 text-sm font-bold text-ink">{t('progress.forms')}</h4>
          <CumulativeChart labels={labels} shaded={shaded} height={220} lines={[
            ...(hasCases ? [{ key: 'due', label: t('progress.formsDue'), color: '#7C5CBF', dotted: true, step: true,
              values: points.map(p => p.expected_cases ?? 0) }] : []),
            { key: 'done', label: t('progress.formsDone'), color: MASD_COLORS.activity, values: points.map(p => p.activities) },
          ]} />
        </div>
        <div>
          <h4 className="mb-1 text-sm font-bold text-ink">{t('progress.adoptions')}</h4>
          <CumulativeChart labels={labels} shaded={shaded} height={220} lines={[
            { key: 'asked', label: t('progress.adoptionsAsked'), color: MASD_COLORS.adoption, dashed: true, step: true,
              values: points.map(p => p.expected_adoptions) },
            { key: 'made', label: t('progress.adoptionsMade'), color: '#1F5560', values: points.map(p => p.adoptions) },
          ]} />
        </div>
      </div>

      {hasCases && (
        <div className="mt-5">
          <h4 className="mb-1 text-sm font-bold text-ink">{t('progress.pctTitle')}</h4>
          <GroupedColumns
            categories={points.map((p, i) => ({ key: p.date, label: short(p.date), sub: weekday(p.date), shaded: shaded[i] }))}
            series={[{ key: 'x', label: t('progress.pctForms'), color: MASD_COLORS.activity,
              values: points.map(p => pct(p.activities, p.expected_cases ?? 0)) }]}
            reference={{ value: 100, label: t('progress.target') }}
            valueSuffix="%" height={180}
          />
        </div>
      )}
    </Card>
  );
};

export default MyProgressChart;
