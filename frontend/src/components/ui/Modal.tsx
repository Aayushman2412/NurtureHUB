import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
} as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  size?: keyof typeof sizes;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Modal on native <dialog> + showModal(): focus trap, ESC handling and
 * top-layer stacking come for free.
 */
const Modal: React.FC<ModalProps> = ({ open, onClose, title, size = 'md', footer, children }) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={e => {
        // click on the backdrop (the dialog element itself) closes
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100vw-2rem)] rounded-2xl bg-surface text-ink shadow-2xl border border-border p-0',
        'backdrop:bg-cream-950/50 backdrop:backdrop-blur-xs',
        'open:animate-fade-in',
        sizes[size],
      )}
    >
      {title !== undefined && (
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
          <h3 className="font-display font-bold text-lg">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-faint hover:text-ink rounded-md p-1 hover:bg-surface-sunken cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
      <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          {footer}
        </div>
      )}
    </dialog>
  );
};

export default Modal;
