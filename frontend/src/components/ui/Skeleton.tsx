import React from 'react';
import { cn } from '../../utils/cn';

export interface SkeletonProps {
  variant?: 'line' | 'block' | 'circle';
  className?: string;
}

const Skeleton: React.FC<SkeletonProps> = ({ variant = 'line', className }) => (
  <div
    aria-hidden
    className={cn(
      'animate-skeleton bg-gradient-to-r from-surface-sunken via-border/60 to-surface-sunken bg-[length:200%_100%]',
      variant === 'line' && 'h-4 rounded-md w-full',
      variant === 'block' && 'h-28 rounded-xl w-full',
      variant === 'circle' && 'size-10 rounded-full',
      className,
    )}
  />
);

export default Skeleton;
