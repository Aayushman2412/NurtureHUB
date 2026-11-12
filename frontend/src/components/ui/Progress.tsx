import React from 'react';
import { cn } from '../../utils/cn';

/** `brand` is plain progress. The others say how it is going. */
export type ProgressTone = 'brand' | 'success' | 'warning' | 'danger';

const barTones: Record<ProgressTone, string> = {
  brand: 'bg-brand-600 dark:bg-brand-400',
  success: 'bg-success-500',
  warning: 'bg-amber-500',
  danger: 'bg-error-500',
};

export interface ProgressBarProps {
  /** 0–100 */
  value: number;
  tone?: ProgressTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, tone = 'brand', size = 'md', className }) => (
  <div
    role="progressbar"
    aria-valuenow={Math.round(value)}
    aria-valuemin={0}
    aria-valuemax={100}
    className={cn(
      'w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800',
      size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2',
      className,
    )}
  >
    <div
      className={cn('h-full rounded-full transition-[width] duration-300 ease-out', barTones[tone])}
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
);

export interface ProgressRingProps {
  /** 0–100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** ring colour comes from the text colour (brand by default) */
  label?: React.ReactNode;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  value,
  size = 88,
  strokeWidth = 8,
  className,
  label,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <div className={cn('relative inline-flex items-center justify-center text-brand-600 dark:text-brand-400', className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-gray-200 dark:stroke-gray-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-ink">
        {label ?? `${Math.round(value)}%`}
      </span>
    </div>
  );
};
