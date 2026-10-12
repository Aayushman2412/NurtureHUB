import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import type { MasdReport } from '../../api/masd';
import { ChipRow, Section } from '../results/InsightParts';
import { CumulativeChart } from './MasdCharts';
import { byGrain, GRAINS, MASD_COLORS, type Grain } from '../../lib/masdDisplay';

const label = (iso: string, grain: Grain) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (grain === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (grain === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });
};

/**
 * Where the project should be by each date, and where it is (review of
 * 6 Oct 2026). Expected adoptions start once each batch's buffer is over and
 * come at one per learner every few days until the tranche is taken;
 * expected activities are the LAP table's figures for the tranches open that
 * day — the same rule as the "% of expected activity" figure, so the lines end
 * on the numbers at the top of the page.
 */
const MasdCumulative: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const [grain, setGrain] = useState<Grain>('week');
  const cum = report.cumulative;
  const points = useMemo(() => byGrain(cum?.days ?? [], grain), [cum, grain]);
  if (!cum || cum.days.length < 2) return null;
  const labels = points.map(p => label(p.date, grain));
  return (
    <Section
      icon={<TrendingUp />}
      title={t('cumulative.title')}
      subtitle={t('cumulative.sub', { n: cum.pace_days })}
      actions={<ChipRow label={t('cumulative.by')} value={grain} onChange={v => setGrain(v as Grain)}
        items={GRAINS.map(g => ({ key: g, label: t(`cumulative.grain.${g}`) }))} />}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <div>
          <h4 className="mb-1 text-sm font-semibold text-ink">{t('cumulative.adoptions')}</h4>
          <CumulativeChart labels={labels} lines={[
            { key: 'exp', label: t('cumulative.expected'), color: MASD_COLORS.adoption, dashed: true, values: points.map(p => p.expected_adoptions) },
            { key: 'act', label: t('cumulative.actual'), color: '#1F5560', values: points.map(p => p.adoptions) },
          ]} />
        </div>
        <div>
          <h4 className="mb-1 text-sm font-semibold text-ink">{t('cumulative.activities')}</h4>
          <CumulativeChart labels={labels} lines={[
            { key: 'exp', label: t('cumulative.expected'), color: MASD_COLORS.activity, dashed: true, values: points.map(p => p.expected_activities) },
            { key: 'act', label: t('cumulative.actual'), color: '#A23B2E', values: points.map(p => p.activities) },
          ]} />
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-muted">{t('cumulative.note', { n: cum.pace_days })}</p>
    </Section>
  );
};

export default MasdCumulative;
