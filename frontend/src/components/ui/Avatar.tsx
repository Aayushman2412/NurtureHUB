import React from 'react';
import { cn } from '../../utils/cn';

const sizes = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-20 text-2xl',
} as const;

export interface AvatarProps {
  name: string;
  src?: string;
  size?: keyof typeof sizes;
  className?: string;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]!.toUpperCase())
    .join('');
}

/** A person: their photo, or their initials on a flat tint. */
const Avatar: React.FC<AvatarProps> = ({ name, src, size = 'md', className }) => (
  <div
    className={cn(
      'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
      'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100',
      sizes[size],
      className,
    )}
    aria-label={name}
    title={name}
  >
    {src ? <img src={src} alt={name} className="size-full object-cover" /> : initials(name) || '?'}
  </div>
);

export default Avatar;
