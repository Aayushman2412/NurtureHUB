import React from 'react';
import { cn } from '../../utils/cn';

export interface TabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface TabsProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  className?: string;
}

/** Controlled tab bar: a rule under the row, a heavier brand rule under the open tab. */
function Tabs<T extends string = string>({ value, onChange, items, className }: TabsProps<T>) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}>
      {items.map(item => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 whitespace-nowrap px-3.5 py-2.5 text-sm',
              '-mb-px border-b-2 transition-colors',
              active
                ? 'border-primary font-semibold text-primary-ink'
                : 'border-transparent font-medium text-ink-muted hover:border-border-strong hover:text-ink',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
