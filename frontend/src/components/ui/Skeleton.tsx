import React from 'react';
import { cn } from '../../utils/cn';

export interface SkeletonProps {
  variant?: 'line' | 'block' | 'circle';
  className?: string;
}

/** A placeholder while content loads. It pulses; it does not shimmer. */
const Skeleton: React.FC<SkeletonProps> = ({ variant = 'line', className }) => (
  <div
    aria-hidden
    className={cn(
      'animate-pulse bg-gray-200 dark:bg-gray-800',
      variant === 'line' && 'h-4 w-full rounded-sm',
      variant === 'block' && 'h-28 w-full rounded-lg',
      variant === 'circle' && 'size-10 rounded-full',
      className,
    )}
  />
);

export default Skeleton;
