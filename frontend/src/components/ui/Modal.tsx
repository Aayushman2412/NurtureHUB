import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  '2xl': 'max-w-[96rem]',
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
  const { t } = useTranslation('common');
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
      onCancel={e => {
        // React propagates the synthetic cancel up the component tree, so the
        // ESC of a nested modal would also close its parent: contain it here.
        e.stopPropagation();
        onClose();
      }}
      onClick={e => {
        // click on the backdrop (the dialog element itself) closes
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-0 text-ink shadow-(--shadow-overlay)',
        'backdrop:bg-gray-950/55',
        'open:animate-overlay-in',
        sizes[size],
      )}
    >
      {title !== undefined && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="cursor-pointer rounded-md p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken/60 px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
};

export default Modal;
