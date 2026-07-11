import React from 'react';
import { cn } from '../../utils/cn';

type CardAccent = 'coral' | 'teal' | 'sage' | 'amber';

const accentBorders: Record<CardAccent, string> = {
  coral: 'border-l-4 border-l-coral-500',
  teal: 'border-l-4 border-l-teal-500',
  sage: 'border-l-4 border-l-sage-500',
  amber: 'border-l-4 border-l-amber-500',
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  locked?: boolean;
  accent?: CardAccent;
}

const Card: React.FC<CardProps> = ({ interactive, locked, accent, className, children, ...rest }) => (
  <div
    className={cn(
      'bg-surface border border-border rounded-xl shadow-(--shadow-card)',
      interactive &&
        'cursor-pointer transition-all duration-200 hover:shadow-(--shadow-card-hover) hover:-translate-y-0.5 hover:border-border-strong',
      locked && 'opacity-70 saturate-50 pointer-events-none',
      accent && accentBorders[accent],
      className,
    )}
    {...rest}
  >
    {children}
  </div>
);

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn('px-6 pt-5 pb-0 flex items-start justify-between gap-3', className)} {...rest}>
    {children}
  </div>
);

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn('p-6', className)} {...rest}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn('px-6 pb-5 pt-0 flex items-center gap-3', className)} {...rest}>
    {children}
  </div>
);

export default Card;
