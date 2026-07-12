import React from 'react';
import { cn } from '../../utils/cn';

export interface DividerProps {
  /** Optional centered label between the two rules. */
  label?: React.ReactNode;
  className?: string;
}

/** A horizontal rule with an optional centered label ("or continue with", etc.). */
const Divider: React.FC<DividerProps> = ({ label, className }) => (
  <div className={cn('flex items-center gap-3', className)} aria-hidden>
    <div className="h-px flex-1 bg-border" />
    {label && <span className="text-xs text-ink-faint">{label}</span>}
    <div className="h-px flex-1 bg-border" />
  </div>
);

export default Divider;
