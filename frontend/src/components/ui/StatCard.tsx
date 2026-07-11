import React from 'react';
import Card from './Card';
import { cn } from '../../utils/cn';

type StatTone = 'coral' | 'sage' | 'amber' | 'neutral';

const iconTones: Record<StatTone, string> = {
  coral: 'bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300',
  sage: 'bg-sage-50 text-sage-700 dark:bg-sage-500/15 dark:text-sage-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
  neutral: 'bg-surface-sunken text-ink-muted',
};

export interface StatCardProps {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  /** e.g. "+12% this month" */
  trend?: React.ReactNode;
  trendDirection?: 'up' | 'down';
  tone?: StatTone;
  className?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  trend,
  trendDirection,
  tone = 'coral',
  className,
}) => (
  <Card className={cn('flex items-center gap-4 p-5', className)}>
    <div
      className={cn('flex items-center justify-center rounded-xl size-12 shrink-0 [&>svg]:size-6', iconTones[tone])}
      aria-hidden
    >
      {icon}
    </div>
    <div className="min-w-0">
      <div className="text-sm text-ink-muted truncate">{label}</div>
      <div className="font-display font-extrabold text-2xl text-ink leading-tight">{value}</div>
      {trend && (
        <div
          className={cn(
            'text-xs font-semibold',
            trendDirection === 'down' ? 'text-error-500' : 'text-success-600',
          )}
        >
          {trend}
        </div>
      )}
    </div>
  </Card>
);

export default StatCard;
