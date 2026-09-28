import React from 'react';
import { Lightbulb, ThumbsUp, TriangleAlert } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { MasdFinding } from '../../api/masd';

/**
 * The plain-language findings under each part of the report — written by the
 * server from the numbers (app/masd/insights.py), the same sentences the
 * downloaded deck carries.
 */
const MasdFindings: React.FC<{ findings?: MasdFinding[]; empty?: string; className?: string }> = ({
  findings, empty, className,
}) => {
  const items = findings ?? [];
  if (!items.length) return empty ? <p className={cn('text-sm text-ink-muted', className)}>{empty}</p> : null;
  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((f, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full [&>svg]:size-3.5',
            f.tone === 'good' && 'bg-success-50 text-success-600 dark:bg-success-500/15',
            f.tone === 'watch' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
            f.tone === 'info' && 'bg-surface-sunken text-ink-muted',
          )}>
            {f.tone === 'good' ? <ThumbsUp /> : f.tone === 'watch' ? <TriangleAlert /> : <Lightbulb />}
          </span>
          <span className="text-sm leading-relaxed text-ink">{f.text}</span>
        </li>
      ))}
    </ul>
  );
};

export default MasdFindings;
