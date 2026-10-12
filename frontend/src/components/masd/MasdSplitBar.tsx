import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { MasdLearner } from '../../api/masd';
import { SplitFilterRow } from '../results/InsightParts';
import { applyFilters, groupOf, groupsOf, usefulDims, type MasdDim, type MasdSplitState } from '../../lib/masdSplit';
export type { MasdSplitState } from '../../lib/masdSplit';

/**
 * Split by / Filter by for the MASD pages (reviews of 6–7 Oct 2026): pick how
 * learners are grouped — cadre, block, department, district, MT+FL, batch,
 * batch monitor, education, experience — or tick groups of any of them to
 * narrow every group chart and table. The same control as on Results.
 */
const MasdSplitBar: React.FC<{
  learners: MasdLearner[];
  state: MasdSplitState;
  onChange: (next: (s: MasdSplitState) => MasdSplitState) => void;
}> = ({ learners, state, onChange }) => {
  const { t } = useTranslation('masd');
  const dims = useMemo(() => usefulDims(learners), [learners]);
  const items = dims.map(d => ({ key: d, label: t(`splitDims.${d}`) }));
  const active = (Object.entries(state.filters) as [MasdDim, string[]][]).filter(([, v]) => v.length);
  const kept = applyFilters(learners, state.filters).length;

  const choices = (d: MasdDim) => {
    const base = applyFilters(learners, state.filters, d);
    return groupsOf(base, d).map(g => ({ value: g, label: g, n: base.filter(l => groupOf(l, d) === g).length }));
  };

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface px-3 py-2.5">
      <SplitFilterRow<MasdDim>
        mode={state.mode}
        onMode={mode => onChange(s => ({ ...s, mode }))}
        items={items}
        dim={dims.includes(state.dim) ? state.dim : (dims[0] ?? 'block')}
        onDim={dim => onChange(s => ({ ...s, dim }))}
        filters={state.filters}
        choices={choices}
        onFilter={(d, values) => onChange(s => {
          const current = s.filters[d] ?? [];
          const next = typeof values === 'function' ? values(current) : values;
          return { ...s, filters: { ...s.filters, [d]: next } };
        })}
      />
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-ink">{t('splitBar.showing', { n: kept, total: learners.length })}</span>
          {active.map(([d, v]) => (
            <button key={d} type="button"
              onClick={() => onChange(s => ({ ...s, filters: { ...s.filters, [d]: [] } }))}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300">
              {t(`splitDims.${d}`)}: {v.join(', ')} <X className="size-3" />
            </button>
          ))}
          <button type="button" className="cursor-pointer font-semibold text-primary-ink hover:underline"
            onClick={() => onChange(s => ({ ...s, filters: {} }))}>{t('splitBar.clear')}</button>
        </div>
      )}
      <p className="text-xs text-ink-muted">{t('splitBar.note')}</p>
    </div>
  );
};

export default MasdSplitBar;
