import React from 'react';
import { cn } from '../../utils/cn';

/** The status rule on the left edge of a panel. Say the status in words as well. */
export type CardAccent = 'brand' | 'success' | 'warning' | 'danger';

const accentRules: Record<CardAccent, string> = {
  brand: 'border-l-[3px] border-l-brand-600',
  success: 'border-l-[3px] border-l-success-500',
  warning: 'border-l-[3px] border-l-amber-500',
  danger: 'border-l-[3px] border-l-error-500',
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  locked?: boolean;
  accent?: CardAccent;
}

/** A panel: flat white surface with a 1px border. Never nest one in another. */
const Card: React.FC<CardProps> = ({ interactive, locked, accent, className, children, ...rest }) => (
  <div
    className={cn(
      'rounded-lg border border-border bg-surface',
      interactive && 'cursor-pointer transition-colors duration-150 hover:border-border-strong hover:bg-surface-sunken/50',
      locked && 'pointer-events-none opacity-60',
      accent && accentRules[accent],
      className,
    )}
    {...rest}
  >
    {children}
  </div>
);

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-0', className)} {...rest}>
    {children}
  </div>
);

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn('p-5', className)} {...rest}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn('flex items-center gap-3 px-5 pt-0 pb-4', className)} {...rest}>
    {children}
  </div>
);

export default Card;
