import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { TONE_GOOD, TONE_LOW, TONE_OK } from '../../utils/brandColors';

/** What the green / amber / red of a rate means (review of 7 Oct 2026). */
const RateLegend: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation('masd');
  const items: [string, string][] = [[TONE_GOOD, t('legend.green')], [TONE_OK, t('legend.amber')], [TONE_LOW, t('legend.red')]];
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted', className)}>
      <span className="font-semibold text-ink">{t('legend.title')}</span>
      {items.map(([c, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: c }} aria-hidden />{label}
        </span>
      ))}
    </div>
  );
};

export default RateLegend;
