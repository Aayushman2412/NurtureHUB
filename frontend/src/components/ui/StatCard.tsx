import React from 'react';
import Card from './Card';
import { cn } from '../../utils/cn';

/**
 * `neutral` is a plain figure. The other tones are STATUS, not decoration:
 * they draw the left rule, so use one only when the figure really is good,
 * needs watching, or needs action.
 */
type StatTone = 'neutral' | 'success' | 'warning' | 'danger';

const statusRule: Record<StatTone, string> = {
  neutral: '',
  success: 'border-l-[3px] border-l-success-500',
  warning: 'border-l-[3px] border-l-amber-500',
  danger: 'border-l-[3px] border-l-error-500',
};

export interface StatCardProps {
  /** Optional small glyph beside the label. Never a tinted tile. */
  icon?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  /** e.g. "+12% this month" */
  trend?: React.ReactNode;
  trendDirection?: 'up' | 'down';
  tone?: StatTone;
  /**
   * Let a long label wrap onto a second line instead of being clipped.
   *
   * Off by default: the dense dashboard rows use short labels and rely on a
   * uniform single-line height. Turn it on where the label carries something
   * the reader cannot infer, such as the time window of a metric: "12 refused"
   * means nothing without "in 24 hours".
   */
  wrapLabel?: boolean;
  className?: string;
}

/** One figure: its label above, the number below. */
const StatCard: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  trend,
  trendDirection,
  tone = 'neutral',
  wrapLabel = false,
  className,
}) => (
  <Card className={cn('min-w-0 px-4 py-3.5', statusRule[tone], className)}>
    <div className={cn('flex gap-1.5 text-sm text-ink-muted', wrapLabel ? 'items-start' : 'items-center')}>
      {icon && <span className={cn('shrink-0 text-ink-faint [&>svg]:size-4', wrapLabel && 'mt-0.5')} aria-hidden>{icon}</span>}
      <span className={cn('min-w-0', wrapLabel ? 'min-h-10 text-pretty line-clamp-2' : 'truncate')}>{label}</span>
    </div>
    <div className="mt-1 text-2xl font-semibold leading-tight tabular-nums text-ink">{value}</div>
    {trend && (
      <div
        className={cn(
          'mt-0.5 text-xs font-medium',
          trendDirection === 'down' ? 'text-error-600 dark:text-error-300' : 'text-success-600 dark:text-success-300',
        )}
      >
        {trend}
      </div>
    )}
  </Card>
);

export default StatCard;
