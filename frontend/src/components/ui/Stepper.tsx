import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface StepperProps {
  steps: string[];
  /** 0-based index of the current step */
  current: number;
  className?: string;
}

const Stepper: React.FC<StepperProps> = ({ steps, current, className }) => (
  <ol className={cn('flex items-center gap-2', className)}>
    {steps.map((step, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <li key={step} className="flex items-center gap-2 min-w-0">
          {i > 0 && <span className={cn('h-px w-6 sm:w-10', done || active ? 'bg-primary' : 'bg-border')} />}
          <span
            className={cn(
              'flex items-center justify-center size-7 rounded-full text-xs font-bold shrink-0 transition-colors',
              done && 'bg-primary text-primary-fg',
              active && 'bg-primary/15 text-primary ring-2 ring-primary',
              !done && !active && 'bg-surface-sunken text-ink-faint',
            )}
            aria-current={active ? 'step' : undefined}
          >
            {done ? <Check className="size-4" /> : i + 1}
          </span>
          <span
            className={cn(
              'text-sm truncate max-sm:hidden',
              active ? 'font-semibold text-ink' : 'text-ink-muted',
            )}
          >
            {step}
          </span>
        </li>
      );
    })}
  </ol>
);

export default Stepper;
