import React from 'react';
import { cn } from '../../utils/cn';

export interface FieldLabelProps {
  htmlFor?: string;
  /** 'md' = standard form label; 'sm' = compact muted label (admin panels). */
  size?: 'md' | 'sm';
  className?: string;
  children: React.ReactNode;
}

/** Standalone form-control label with consistent styling. */
export const FieldLabel: React.FC<FieldLabelProps> = ({ htmlFor, size = 'md', className, children }) => (
  <label
    htmlFor={htmlFor}
    className={cn(
      'block font-semibold',
      size === 'sm' ? 'mb-1.5 text-xs text-ink-muted' : 'mb-2 text-sm text-ink',
      className,
    )}
  >
    {children}
  </label>
);

export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

/** A labeled form field: a label above its control. */
export const Field: React.FC<FieldProps> = ({ label, htmlFor, className, children }) => (
  <div className={className}>
    <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
    {children}
  </div>
);
