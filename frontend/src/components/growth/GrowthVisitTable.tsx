import React from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowthVisitDetail } from '../../api/growth';
import { formatAge } from '../../lib/growthChart';
import { percentileOf, TONE_CLASSES, toneOf } from '../../lib/babyStatus';
import { cn } from '../../utils/cn';

/** A percentile in its traffic-light colour, or a dash. */
const Pct: React.FC<{ z: number | null | undefined }> = ({ z }) => {
  const pct = percentileOf(z);
  const tone = toneOf(z);
  return pct == null || !tone ? <span className="text-ink-faint">—</span>
    : <span className={cn('font-semibold tabular-nums', TONE_CLASSES[tone].text)}>P{pct}</span>;
};

/**
 * Every measured visit in one table beside the charts (review of 30 Oct 2026:
 * "give a table adjacent to this graph in the form of visit date, age at
 * visit, weight, height and the corresponding percentiles"). Percentiles, not
 * z-scores, as Dr Rupal asked for the worker's view.
 */
const GrowthVisitTable: React.FC<{ visits: GrowthVisitDetail[]; className?: string }> = ({ visits, className }) => {
  const { t } = useTranslation('growth');
  const measured = visits.filter(v => v.weight != null || v.length != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (measured.length === 0) return null;
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface', className)}>
      <table className="w-full text-sm">
        <caption className="px-3 pt-2.5 text-left font-display text-sm font-semibold text-ink">{t('visitTable.title')}</caption>
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="px-3 py-2 font-semibold">{t('visitTable.date')}</th>
            <th className="px-2 py-2 font-semibold">{t('visitTable.age')}</th>
            <th className="px-2 py-2 text-right font-semibold">{t('visitTable.weight')}</th>
            <th className="px-2 py-2 text-right font-semibold">{t('visitTable.length')}</th>
            <th className="px-2 py-2 text-right font-semibold">{t('visitTable.wfa')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('visitTable.lfa')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {measured.map(v => (
            <tr key={v.date}>
              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink">{v.date.split('-').reverse().join('/')}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">{v.age_days != null ? formatAge(v.age_days) : '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink">{v.weight ?? '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink">{v.length ?? '—'}</td>
              <td className="px-2 py-1.5 text-right"><Pct z={v.z?.wfaz} /></td>
              <td className="px-3 py-1.5 text-right"><Pct z={v.z?.hfaz} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default GrowthVisitTable;
