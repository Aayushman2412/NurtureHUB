import React from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowthCase, GrowthIndicator, GrowthStandards } from '../../api/growth';
import {
  ageTicks,
  buildSeries,
  COHORT_SPECS,
  lengthTicks,
  percentileColor,
  PERCENTILE_KEYS,
  sourceComboColor,
  type GrowthCohort,
  type GrowthPoint,
  type VisitSourceCombo,
} from '../../lib/growthChart';
import GrowthChart from './GrowthChart';

const INDICATORS: GrowthIndicator[] = ['wfa', 'lfa', 'wfl'];
const SOURCE_COMBOS: VisitSourceCombo[] = ['birth', 'growth', 'growth_bf', 'growth_cf', 'growth_bf_cf'];

/** Color legend: the five WHO percentile curves + the visit source combos. */
export const GrowthLegend: React.FC = () => {
  const { t } = useTranslation('growth');
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold text-ink">{t('legend.percentiles')}:</span>
        {PERCENTILE_KEYS.map(key => (
          <span key={key} className="flex items-center gap-1 text-ink-muted">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: percentileColor(key) }} />
            {t(`percentiles.${key}`)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold text-ink">{t('legend.sources')}:</span>
        {SOURCE_COMBOS.map(combo => (
          <span key={combo} className="flex items-center gap-1 text-ink-muted">
            <span className="inline-block size-2.5 rounded-full" style={{ background: sourceComboColor(combo) }} />
            {t(`sources.${combo}`)}
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * The chart battery for one sex: per cohort (under / over 150 days) the three
 * WHO charts — weight-for-age, length-for-age, weight-for-length.
 */
interface GrowthChartGridProps {
  cases: GrowthCase[];
  sex: 'boys' | 'girls';
  standards: GrowthStandards;
  cohorts?: GrowthCohort[];
  onPointClick: (point: GrowthPoint) => void;
}

const GrowthChartGrid: React.FC<GrowthChartGridProps> = ({
  cases,
  sex,
  standards,
  cohorts = ['young', 'old'],
  onPointClick,
}) => {
  const { t } = useTranslation('growth');

  return (
    <div className="space-y-6">
      {cohorts.map(cohort => {
        const spec = COHORT_SPECS[cohort];
        return (
          <section key={cohort}>
            <h2 className="mb-3 font-display text-base font-bold text-ink">
              {t(`cohorts.${cohort}`)}
            </h2>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {INDICATORS.map(indicator => {
                const isWfl = indicator === 'wfl';
                const series = cases
                  .map(c => buildSeries(c, indicator, cohort))
                  .filter(s => s.points.length > 0);
                return (
                  <GrowthChart
                    key={indicator}
                    title={`${t(`indicators.${indicator}`)} — ${t(`sexTabs.${sex}`)}`}
                    subtitle={t(`cohorts.${cohort}`)}
                    xLabel={
                      isWfl
                        ? t('axis.lengthCm')
                        : cohort === 'young'
                          ? t('axis.ageWeeks')
                          : t('axis.ageMonths')
                    }
                    yLabel={indicator === 'lfa' ? t('axis.lengthCm') : t('axis.weightKg')}
                    standards={standards[indicator][sex]}
                    xDomain={isWfl ? spec.lengthDomain : spec.ageDomain}
                    xTicks={isWfl ? lengthTicks(cohort) : ageTicks(cohort)}
                    xKind={isWfl ? 'length' : 'age'}
                    series={series}
                    onPointClick={onPointClick}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default GrowthChartGrid;
