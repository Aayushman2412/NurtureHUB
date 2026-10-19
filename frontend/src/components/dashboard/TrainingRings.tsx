import React from 'react';
import { useTranslation } from 'react-i18next';
import { Award, ClipboardCheck, PlayCircle, Video } from 'lucide-react';
import { ProgressRing } from '../ui';
import { cn } from '../../utils/cn';

export interface RingTutorial {
  is_completed: boolean;
  duration_minutes?: number;
  watch_pct?: number;
  quiz_available?: boolean;
  quiz_status?: 'pending' | 'completed' | 'skipped';
}

/** A learner's best score in each test, as a percentage (null: not taken). */
export interface RingScores {
  formative: number | null;
  screening: number | null;
}

/**
 * Training at a glance — four circles, two by two on a phone (review of 17
 * Oct 2026): videos completed, the watch duration as a share of all the video
 * time (the same progress bar the player shows: skipping does not count), the
 * quizzes after the videos, and the two test scores — formative on top,
 * screening below (19 Oct: "passing test will not give any information to
 * take any action ... you just give the score here"). All real numbers.
 */
const TrainingRings: React.FC<{
  tutorials: RingTutorial[];
  scores: RingScores;
}> = ({ tutorials, scores }) => {
  const { t } = useTranslation('dashboard');
  const done = tutorials.filter(x => x.is_completed).length;
  const minutes = tutorials.reduce((s, x) => s + Math.max(1, x.duration_minutes ?? 1), 0);
  const watched = tutorials.reduce((s, x) => s + Math.max(1, x.duration_minutes ?? 1) * Math.min(100, x.watch_pct ?? (x.is_completed ? 100 : 0)), 0);
  const watchPct = minutes ? Math.round(watched / minutes) : 0;
  const quizzes = tutorials.filter(x => x.quiz_available);
  const quizDone = quizzes.filter(x => x.quiz_status === 'completed').length;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const fmt = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`);

  const rings = [
    { key: 'videos', icon: <Video className="size-4" />, value: pct(done, tutorials.length), main: `${done}/${tutorials.length}`, tone: 'text-coral-500' },
    { key: 'watched', icon: <PlayCircle className="size-4" />, value: watchPct, main: `${watchPct}%`, tone: 'text-sage-500' },
    { key: 'quizzes', icon: <ClipboardCheck className="size-4" />, value: pct(quizDone, quizzes.length), main: quizzes.length ? `${quizDone}/${quizzes.length}` : '—', tone: 'text-primary-ink' },
    {
      key: 'tests', icon: <Award className="size-4" />,
      // The ring fills to the latest score: the screening test once taken.
      value: scores.screening ?? scores.formative ?? 0,
      main: (
        <span className="flex flex-col text-[10.5px] font-bold leading-tight">
          <span>{t('rings.ft')} {fmt(scores.formative)}</span>
          <span>{t('rings.st')} {fmt(scores.screening)}</span>
        </span>
      ),
      tone: 'text-amber-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {rings.map(r => (
        <div key={r.key} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-3 text-center sm:flex-row sm:gap-3 sm:text-left">
          <ProgressRing
            value={r.value} size={64} strokeWidth={7} className={cn('shrink-0', r.tone)}
            label={typeof r.main === 'string' ? <span className="text-[13px] tabular-nums">{r.main}</span> : r.main}
          />
          <div className="min-w-0">
            <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-ink sm:justify-start">
              <span className="hidden sm:inline">{r.icon}</span><span>{t(`rings.${r.key}`)}</span>
            </div>
            <p className="mt-0.5 text-xs leading-snug text-ink-muted">{t(`rings.${r.key}Hint`, { count: tutorials.length })}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TrainingRings;
