import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { FlowOption, VerdictDef } from '../../lib/flowTypes';
import { resolveAssetUrl } from '../../lib/flowGraph';
import VerdictChip from './VerdictChip';

export interface OptionCardProps {
  option: FlowOption;
  selected: boolean;
  onToggle: () => void;
  /** Admin switch: show the option's image (falls back to the letter tile). */
  showMedia?: boolean;
  /**
   * The resolved verdict definition to reveal on selection, or null to reveal
   * nothing (verdict timing is 'after'/'never', or the option has no verdict).
   */
  verdictDef?: VerdictDef | null;
  /** 'tile' = picture on top; 'row' = one slim line with a tick circle (no
   *  pictures to show); 'chip' = a small box, for counts like "3 days". */
  layout?: 'tile' | 'row' | 'chip';
}

/**
 * A large tappable answer card: media (image/gif) on top — or a warm initial
 * letter tile when there is none — label below, ring + check when selected,
 * and a soft verdict chip revealed after selection.
 */
const OptionCard: React.FC<OptionCardProps> = ({
  option,
  selected,
  onToggle,
  showMedia = true,
  verdictDef = null,
  layout = 'tile',
}) => {
  const media = showMedia ? option.media[0] : undefined;
  const initial = (option.label.trim()[0] ?? '?').toUpperCase();

  // Without a picture, a big letter tile only pushes the other answers off the
  // screen (review of 30 Oct 2026: "this big boxes for each of the days is not
  // essential").
  if (layout !== 'tile') {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={cn(
          'flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 bg-surface px-3.5 py-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          layout === 'chip' && 'justify-center px-2 text-center',
          selected ? 'border-primary bg-coral-50 dark:bg-coral-500/10' : 'border-border hover:border-border-strong',
        )}
      >
        {layout === 'row' && (
          <span aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border-2',
            selected ? 'border-primary bg-primary text-primary-fg' : 'border-ink-faint')}>
            {selected && <Check className="size-4" strokeWidth={3} />}
          </span>
        )}
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-sm font-semibold leading-snug text-ink">{option.label}</span>
          {selected && verdictDef && <VerdictChip def={verdictDef} className="animate-fade-in" />}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border-2 bg-surface text-left',
        'transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/25'
          : 'border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
      )}
    >
      {media ? (
        <img
          src={resolveAssetUrl(media.url)}
          alt=""
          loading="lazy"
          draggable={false}
          className="aspect-[4/3] w-full select-none object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-coral-50 to-cream-200 dark:from-coral-950/50 dark:to-cream-900"
        >
          <span className="font-display text-4xl font-bold text-coral-300 dark:text-coral-800">
            {initial}
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col items-start gap-1.5 p-3">
        <span className="text-sm font-semibold leading-snug text-ink">{option.label}</span>
        {selected && verdictDef && (
          <VerdictChip def={verdictDef} className="animate-fade-in" />
        )}
      </div>

      {/* selection check */}
      <span
        aria-hidden
        className={cn(
          'absolute right-2 top-2 flex size-6 items-center justify-center rounded-full shadow-sm',
          'transition-all duration-150',
          selected ? 'scale-100 bg-primary text-primary-fg opacity-100' : 'scale-50 opacity-0',
        )}
      >
        <Check className="size-4" strokeWidth={3} />
      </span>
    </button>
  );
};

export default OptionCard;
