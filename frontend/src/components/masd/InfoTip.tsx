import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * A round (i) next to a figure that opens a short explanation (review of
 * 12 Oct 2026: "an i symbol in a round where each level can be understood").
 * Opens on hover or tap, closes on Escape or a click elsewhere.
 */
const InfoTip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full border border-border-strong text-ink-muted hover:text-ink">
        <Info className="size-3.5" />
      </button>
      {open && (
        <span role="tooltip"
          className="absolute left-1/2 top-full z-(--z-dropdown) mt-1.5 w-72 -translate-x-1/2 rounded-xl border border-border bg-surface-raised p-3 text-left text-xs font-normal leading-relaxed text-ink shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
};

export default InfoTip;
