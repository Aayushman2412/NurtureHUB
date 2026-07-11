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

const Avatar: React.FC<AvatarProps> = ({ name, src, size = 'md', className }) => (
  <div
    className={cn(
      'inline-flex items-center justify-center rounded-full font-display font-bold select-none shrink-0',
      'bg-gradient-to-br from-coral-400 to-coral-600 text-white overflow-hidden',
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
