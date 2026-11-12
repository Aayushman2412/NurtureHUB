import React from 'react';
import { useTranslation } from 'react-i18next';
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

/** What the page is, one line about it, and its actions. Every page starts with one. */
const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, backTo, className }) => {
  const { t } = useTranslation('common');
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-border pb-4', className)}>
      <div className="min-w-0">
        {backTo && (
          // A 52x20 text link is the hardest thing on the page to hit with a
          // thumb; give it a real touch target on a phone without changing how
          // it looks on a desktop.
          <Link
            to={backTo}
            className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-ink-muted transition-colors hover:text-ink sm:ml-0 sm:mb-2 sm:min-h-0 sm:px-0"
          >
            <ArrowLeft className="size-4" /> {t('back')}
          </Link>
        )}
        <h2 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h2>
        {description && <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
};

export default PageHeader;
