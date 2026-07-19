import React from 'react';
import { Baby } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

export interface ChildChipProps {
  name: string;
  uid?: string | null;
  ageDays?: number | null;
  ageMonths?: number | null;
  className?: string;
}

/** Compact identity chip for the child an assessment belongs to. */
const ChildChip: React.FC<ChildChipProps> = ({ name, uid, ageDays, ageMonths, className }) => {
  const { t } = useTranslation('assessments');
  const age =
    ageMonths != null && ageMonths >= 1
      ? t('common.ageMonths', { n: ageMonths })
      : ageDays != null && ageDays >= 0
        ? t('common.ageDays', { n: ageDays })
        : null;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full bg-coral-50 px-3 py-1 text-xs font-semibold',
        'text-coral-700 dark:bg-coral-500/10 dark:text-coral-300',
        className,
      )}
    >
      <Baby className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {name}
        {uid ? ` · ${uid}` : ''}
        {age ? ` · ${age}` : ''}
      </span>
    </span>
  );
};

export default ChildChip;
