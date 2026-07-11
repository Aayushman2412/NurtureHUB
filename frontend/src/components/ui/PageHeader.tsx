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
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-2 transition-colors"
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
