import React from 'react';
import { AlertCircle, CheckCircle2, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import type { VerdictDef } from '../../lib/flowTypes';
import { isBuiltinVerdict } from '../../lib/flowTypes';

export interface VerdictChipProps {
  /** The resolved verdict definition; null renders nothing. */
  def: VerdictDef | null;
  className?: string;
}

/**
 * Soft verdict pill, coloured and labelled from the form's verdict definition.
 * No verdict renders nothing — deliberately quiet, never alarming.
 *
 * The two built-ins keep their translated labels; admin-defined verdicts show
 * the label as typed (free-text admin content has no translation).
 */
const VerdictChip: React.FC<VerdictChipProps> = ({ def, className }) => {
  const { t } = useTranslation('assessments');
  if (!def) return null;

  const label = isBuiltinVerdict(def.id)
    ? def.id === 'green'
      ? t('common.asPerLap')
      : t('common.needsAttention')
    : def.label;

  const Icon =
    def.scoring === 'positive' ? CheckCircle2 : def.scoring === 'negative' ? AlertCircle : Circle;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        className,
      )}
      // A custom verdict carries an arbitrary colour, so the tint is inline —
      // color-mix keeps the fill soft in both light and dark themes.
      style={{
        color: def.color,
        backgroundColor: `color-mix(in srgb, ${def.color} 14%, transparent)`,
      }}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
};

export default VerdictChip;
