import React from 'react';
import { cn } from '../../utils/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Nothing here yet: say what is missing and what to do next. */
const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-5 py-9 text-center',
      className,
    )}
  >
    {icon && <div className="mb-1 text-ink-faint [&>svg]:size-6" aria-hidden>{icon}</div>}
    <h4 className="text-sm font-semibold text-ink">{title}</h4>
    {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export default EmptyState;
