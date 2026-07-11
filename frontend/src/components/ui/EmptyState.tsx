import React from 'react';
import { cn } from '../../utils/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center text-center gap-2 rounded-xl',
      'border border-dashed border-border-strong/60 bg-surface-sunken/40 px-6 py-12',
      className,
    )}
  >
    {icon && <div className="text-ink-faint mb-1 [&>svg]:size-10" aria-hidden>{icon}</div>}
    <h4 className="font-display font-bold text-ink">{title}</h4>
    {description && <p className="text-sm text-ink-muted max-w-sm">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export default EmptyState;
