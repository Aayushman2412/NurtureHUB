import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MasdReport } from '../../api/masd';
import { Kpi } from '../results/InsightParts';
import { Ring } from '../results/InsightCharts';
import { fmt1, rateTone } from '../../lib/masdDisplay';
import { applyFilters, levelsFor, type MasdSplitState } from '../../lib/masdSplit';
import InfoTip from './InfoTip';

const RingFor: React.FC<{ v: number | null }> = ({ v }) => (
  <Ring value={Math.min(v ?? 0, 100)} color={rateTone(v ?? 0)}>{fmt1(v)}</Ring>
);

/**
 * The adoption target and the three levels of expected activity (review of
 * 12 Oct 2026), each with a round (i) explaining it, recounted for whatever
 * the Filter by keeps.
 */
const MasdLevelKpis: React.FC<{ report: MasdReport; split: MasdSplitState; level3?: boolean }> = ({ report, split, level3 = false }) => {
  const { t } = useTranslation('masd');
  const v = useMemo(() => levelsFor(applyFilters(report.learners.filter(l => l.f2f), split.filters)),
    [report.learners, split.filters]);
  const idealRol = report.calendar.tranches.reduce((a, tr) => a + tr.community.total, 0);
  const idealSn = report.calendar.tranches.reduce((a, tr) => a + tr.nurse.total, 0);
  const label = (text: string, tip: React.ReactNode) => (
    <span className="inline-flex items-center gap-1.5">{text}<InfoTip label={text}>{tip}</InfoTip></span>
  );
  return (
    <>
      <Kpi visual={<RingFor v={v.fulfilment} />} label={label(t('kpi.fulfilment'), t('levels.tipTarget'))}
        value={t('kpi.fulfilmentSub', { n: v.adoptions.toLocaleString(), target: v.target.toLocaleString() })} />
      <Kpi visual={<RingFor v={v.level1} />}
        label={label(t('kpi.level1b'), t('levels.tip1', { rol: idealRol, sn: idealSn }))}
        value={t('kpi.level1Sub', { n: v.activities.toLocaleString(), ideal: Math.round(v.ideal).toLocaleString(), rol: idealRol, sn: idealSn })} />
      <Kpi visual={<RingFor v={v.level2} />} label={label(t('kpi.level2b'), t('levels.tip2'))}
        value={t('kpi.undertakenSub', { n: v.undertakenActual.toLocaleString(), expected: v.undertakenExpected.toLocaleString() })} />
      {level3 && (
        <Kpi visual={<RingFor v={v.level3} />} label={label(t('kpi.level3b'), t('levels.tip3'))}
          value={t('kpi.ownSub', { n: v.ownActual.toLocaleString(), expected: v.ownExpected.toLocaleString() })} />
      )}
    </>
  );
};

export default MasdLevelKpis;
