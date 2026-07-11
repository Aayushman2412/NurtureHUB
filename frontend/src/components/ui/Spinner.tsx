import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

export const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  <Loader2 className={cn('size-6 animate-spin text-primary', className)} aria-label="Loading" />
);

/** Centered full-area loader — replaces the per-page copy-pasted loading blocks. */
export const PageLoader: React.FC<{ label?: string; className?: string }> = ({
  label = 'Loading…',
  className,
}) => (
  <div className={cn('flex flex-col items-center justify-center gap-3 min-h-[60vh]', className)}>
    <Spinner className="size-8" />
    <span className="text-sm text-ink-muted">{label}</span>
  </div>
);
