import React from 'react';
import { cn } from '../../utils/cn';

type ProgressTone = 'coral' | 'sage' | 'amber';

const barTones: Record<ProgressTone, string> = {
  coral: 'bg-coral-500',
  sage: 'bg-sage-500',
  amber: 'bg-amber-500',
};

export interface ProgressBarProps {
  /** 0–100 */
  value: number;
  tone?: ProgressTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, tone = 'coral', size = 'md', className }) => (
  <div
    role="progressbar"
    aria-valuenow={Math.round(value)}
    aria-valuemin={0}
    aria-valuemax={100}
    className={cn(
      'w-full rounded-full bg-surface-sunken overflow-hidden',
      size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2',
      className,
    )}
  >
    <div
      className={cn('h-full rounded-full transition-[width] duration-700 ease-out', barTones[tone])}
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
  /** ring color comes from text color — defaults to coral */
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
    <div className={cn('relative inline-flex items-center justify-center text-coral-500', className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-surface-sunken"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display font-bold text-ink">
        {label ?? `${Math.round(value)}%`}
      </span>
    </div>
  );
};
