import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import type { Verdict } from '../../lib/flowTypes';

export interface VerdictChipProps {
  verdict: Verdict;
  className?: string;
}

/**
 * Soft verdict pill: green "As per LAP" / red "Needs attention".
 * Neutral verdicts render nothing — deliberately quiet, never alarming.
 */
const VerdictChip: React.FC<VerdictChipProps> = ({ verdict, className }) => {
  const { t } = useTranslation('assessments');
  if (!verdict) return null;
  const green = verdict === 'green';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        green
          ? 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500'
          : 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500',
        className,
      )}
    >
      {green ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : (
        <AlertCircle className="size-3" aria-hidden />
      )}
      {green ? t('common.asPerLap') : t('common.needsAttention')}
    </span>
  );
};

export default VerdictChip;
