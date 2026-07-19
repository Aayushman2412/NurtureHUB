import React from 'react';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FormResponseListItem } from '../../lib/flowTypes';
import { formatDisplayDate } from './flowRunner';

export interface TrendStripProps {
  /** Submitted responses, oldest first. */
  items: FormResponseListItem[];
}

/**
 * A tiny pure-CSS bar strip: one column per submitted assessment, green fill =
 * share of answers that were "as per LAP" that day. Reads left → right in time.
 */
const TrendStrip: React.FC<TrendStripProps> = ({ items }) => {
  const { t, i18n } = useTranslation('assessments');
  if (items.length < 2) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500">
        <TrendingUp className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-ink-muted">{t('history.trendTitle')}</div>
        <div className="mt-1.5 flex h-8 items-end gap-1">
          {items.map(r => {
            const green = r.summary_json?.green ?? 0;
            const red = r.summary_json?.red ?? 0;
            const denom = green + red;
            const ratio = denom > 0 ? green / denom : 0;
            return (
              <div
                key={r.id}
                title={t('history.trendBarTitle', {
                  date: formatDisplayDate(r.assessment_date, i18n.language),
                  green,
                  total: denom,
                })}
                className="relative h-full w-2.5 overflow-hidden rounded-full bg-error-500/15 dark:bg-error-500/20"
              >
                <div
                  className="absolute inset-x-0 bottom-0 rounded-full bg-success-500 transition-[height] duration-700 ease-out"
                  style={{ height: `${Math.round(ratio * 100)}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TrendStrip;
