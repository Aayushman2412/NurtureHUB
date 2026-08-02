import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  backTo?: string;
  className?: string;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, backTo, className }) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-4 mb-6', className)}>
    <div className="min-w-0">
      {backTo && (
        // A 52x20 text link is the hardest thing on the page to hit with a
        // thumb; give it a real touch target on a phone without changing how
        // it looks on a desktop.
        <Link
          to={backTo}
          className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-ink-muted transition-colors hover:text-ink sm:ml-0 sm:mb-2 sm:min-h-0 sm:px-0"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
      )}
      <h2 className="font-display font-bold text-2xl text-ink">{title}</h2>
      {description && <p className="text-sm text-ink-muted mt-1">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
  </div>
);

export default PageHeader;
