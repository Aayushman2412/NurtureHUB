import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DotState, VisitTimeline as Timeline } from '../../api/visits';
import { cn } from '../../utils/cn';
import { dayMonth } from './fieldText';

const DOT: Record<DotState, string> = {
  done: 'bg-success-500 text-white',
  missed: 'bg-error-500 text-white',
  due: 'bg-surface text-primary-ink ring-[3px] ring-primary font-bold',
  next: 'bg-surface text-primary-ink ring-2 ring-primary/70',
  later: 'bg-surface text-ink-faint ring-1 ring-border-strong',
};

/**
 * The adoption's visits as a line of dots (Learner Redesign review, 30 Oct
 * 2026: "every adoption shows its own visit line: green done, red missed,
 * outlined next — the same picture works for the M&E dashboard"). One line
 * per part of the schedule: for a baby under 6 months the growth and
 * breastfeeding visits, then the complementary feeding ones from 180 days.
 * Colour is never alone: each dot carries its number and, for a reader, its
 * state and date.
 */
const VisitTimeline: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const { t } = useTranslation('dashboard');
  return (
    <div className="flex flex-col gap-3">
      {timeline.lines.map((line, i) => (
        <div key={`${line.key}-${i}`} className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-ink-muted">{t(`field.timeline.line.${line.key}`)}</p>
          <ol className="flex flex-wrap gap-1.5">
            {line.visits.map(v => {
              const date = dayMonth(v.done_on ?? v.due_on);
              const label = t(`field.timeline.dot.${v.state}`, { date });
              return (
                <li key={v.n} title={label} aria-label={`${v.n}: ${label}`}
                  className={cn('flex size-7 items-center justify-center rounded-full text-[11px] tabular-nums', DOT[v.state])}>
                  {v.n}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      <p className="text-xs text-ink-muted">{t('field.timeline.legend')}</p>
    </div>
  );
};

export default VisitTimeline;
