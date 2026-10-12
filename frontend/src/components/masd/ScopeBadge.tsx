import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Split } from 'lucide-react';
import type { MasdDim, MasdSplitState } from '../../lib/masdSplit';

/**
 * Right beside a chart's title, what Split by / Filter by is doing to it
 * (review of 12 Oct 2026): green "Split by Department" when the section is
 * grouped by the chosen dimension, green "Filter on: …" when ticked groups
 * narrow it. Nothing when neither applies.
 */
const ScopeBadge: React.FC<{ split: MasdSplitState; splits?: boolean }> = ({ split, splits = false }) => {
  const { t } = useTranslation('masd');
  const active = (Object.entries(split.filters) as [MasdDim, string[]][]).filter(([, v]) => v.length);
  if (!splits && !active.length) return null;
  const pill = 'inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-300';
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
      {splits && (
        <span className={pill}><Split className="size-3" />{t('scope.split', { dim: t(`splitDims.${split.dim}`) })}</span>
      )}
      {active.length > 0 && (
        <span className={pill} title={active.map(([d, v]) => `${t(`splitDims.${d}`)}: ${v.join(', ')}`).join(' · ')}>
          <Filter className="size-3" />
          {t('scope.filter', { what: active.map(([d, v]) => `${t(`splitDims.${d}`)}: ${v.length > 2 ? t('scope.groups', { n: v.length }) : v.join(', ')}`).join(' · ') })}
        </span>
      )}
    </span>
  );
};

export default ScopeBadge;
