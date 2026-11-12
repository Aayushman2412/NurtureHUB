import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

/**
 * The EduPoshan mark: a growth chart. A pale reference curve, and the white
 * curve of one child ending at the latest measurement. Same drawing as
 * frontend/brand/logo.svg, which the app icons are generated from.
 */
export const BrandMark: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <svg
    viewBox="0 0 32 32"
    className={cn('size-8 shrink-0', className)}
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title && <title>{title}</title>}
    <rect width="32" height="32" rx="6" fill="#0F5562" />
    <path d="M6 22.5C11.5 21.2 16 17.6 19.6 13.6S24.4 8.4 26.5 7.6" fill="none" stroke="#80C1CB" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M6 26C11 25.2 15 22.6 18.8 18.3" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="19.6" cy="17.4" r="2.6" fill="#FFFFFF" />
  </svg>
);

interface LogoProps {
  className?: string;
  /** A second line under the name, e.g. "Administration". */
  context?: React.ReactNode;
  markClassName?: string;
}

/** Mark and name, used at the top of every shell. */
const Logo: React.FC<LogoProps> = ({ className, context, markClassName }) => {
  const { t } = useTranslation('common');
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <BrandMark className={markClassName} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-base font-semibold text-ink">{t('brand.name')}</span>
        {context && <span className="block truncate text-xs text-ink-muted">{context}</span>}
      </span>
    </span>
  );
};

export default Logo;
