import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../utils/cn';

export interface DropdownItem {
  key: string;
  label: React.ReactNode;
  onSelect: () => void;
  selected?: boolean;
}

export interface DropdownProps {
  trigger: (open: boolean) => React.ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  className?: string;
}

/** Hand-rolled dropdown with click-outside + ESC. */
const Dropdown: React.FC<DropdownProps> = ({ trigger, items, align = 'left', className }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full mt-2 min-w-44 rounded-xl border border-border bg-surface-raised shadow-lg',
            'py-1.5 z-(--z-dropdown) animate-fade-in',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map(item => (
            <button
              key={item.key}
              role="menuitem"
              type="button"
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3.5 py-2 text-sm text-left cursor-pointer transition-colors',
                'hover:bg-surface-sunken',
                item.selected ? 'text-primary-ink font-semibold' : 'text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
