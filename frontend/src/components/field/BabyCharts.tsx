import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowthCase, GrowthStandards, GrowthVisitDetail } from '../../api/growth';
import {
  adoptionCohort, ageTicks, ageUnitFor, buildSeries, cohortDomains, sexKeyForGender, type GrowthPoint,
} from '../../lib/growthChart';
import { percentileOf, TONE_HEX, toneOf } from '../../lib/babyStatus';
import GrowthChart from '../growth/GrowthChart';

/**
 * One baby's weight-for-age and length-for-age charts (launch review of 19 Oct
 * 2026): one baby per chart, the percentile written under each dot in the
 * traffic-light colour. The supervisors' multi-case charts stay theirs.
 */
const BabyCharts: React.FC<{
  who: GrowthCase;
  visits: GrowthVisitDetail[];
  standards: GrowthStandards;
}> = ({ who, visits, standards }) => {
  const { t } = useTranslation('growth');
  const sex = sexKeyForGender(who.child.gender);
  const cohort = adoptionCohort(who);
  const domains = useMemo(() => cohortDomains(cohort, [who]), [cohort, who]);
  const zByDate = useMemo(() => new Map(visits.map(v => [v.date, v.z])), [visits]);
  if (!sex) return <p className="text-sm text-ink-muted">{t('field.noSex', { ns: 'dashboard' })}</p>;

  const label = (key: 'wfaz' | 'hfaz') => (p: GrowthPoint) => {
    const z = p.visit ? zByDate.get(p.visit.date)?.[key] : null;
    const pct = percentileOf(z);
    const tone = toneOf(z);
    return pct != null && tone ? { text: `P${pct}`, color: TONE_HEX[tone] } : null;
  };
  const xLabel = t({ days: 'axis.ageDays', weeks: 'axis.ageWeeks', months: 'axis.ageMonths' }[ageUnitFor(cohort, domains.ageDomain)]);

  return (
    <div className="flex flex-col gap-4">
      {(['wfa', 'lfa'] as const).map(ind => (
        <GrowthChart
          key={ind}
          title={t(`indicators.${ind}`)}
          xLabel={xLabel}
          yLabel={ind === 'lfa' ? t('axis.lengthCm') : t('axis.weightKg')}
          standards={standards[ind][sex]}
          xDomain={domains.ageDomain}
          xTicks={ageTicks(cohort, domains.ageDomain)}
          xKind="age"
          series={[buildSeries(who, ind, cohort)].filter(s => s.points.length > 0)}
          pointLabel={label(ind === 'wfa' ? 'wfaz' : 'hfaz')}
        />
      ))}
    </div>
  );
};

export default BabyCharts;
