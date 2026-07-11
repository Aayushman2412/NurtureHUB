import React from 'react';
import { cn } from '../../utils/cn';

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export const Checkbox: React.FC<CheckboxProps> = ({ label, className, ...rest }) => (
  <label className={cn('inline-flex items-center gap-2.5 cursor-pointer text-sm text-ink', className)}>
    <input type="checkbox" className="size-4 accent-(--primary) cursor-pointer" {...rest} />
    {label}
  </label>
);

export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export const Radio: React.FC<RadioProps> = ({ label, className, ...rest }) => (
  <label className={cn('inline-flex items-center gap-2.5 cursor-pointer text-sm text-ink', className)}>
    <input type="radio" className="size-4 accent-(--primary) cursor-pointer" {...rest} />
    {label}
  </label>
);
