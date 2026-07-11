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

/** Controlled tab bar with a teal active indicator (teal = informational accent). */
function Tabs<T extends string = string>({ value, onChange, items, className }: TabsProps<T>) {
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-border overflow-x-auto', className)}>
      {items.map(item => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap cursor-pointer',
              'border-b-2 -mb-px transition-colors',
              active
                ? 'border-teal-500 text-teal-700 dark:text-teal-300'
                : 'border-transparent text-ink-muted hover:text-ink',
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
