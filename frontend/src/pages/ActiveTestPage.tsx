import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { submitAttempt } from '../api/tests';
import { useToast } from '../context/ToastContext';
import { AlertCircle, Clock, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, Modal } from '../components/ui';
import { cn } from '../utils/cn';

interface Option {
  id: number;
  label: string;
  text: string;
}

interface Question {
  id: number;
  text: string;
  marks: number;
  order_index: number;
  options: Option[];
}

interface AttemptData {
  attempt_id: number;
  duration_minutes: number;
  started_at?: string;
  questions: Question[];
}

interface AnswerState {
  [question_id: number]: {
    selected_option_id: number | null;
    is_marked_for_review: boolean;
  };
}

/** Calculate remaining seconds from a start timestamp and total duration. */
const calcRemaining = (startIso: string, durationMinutes: number): number => {
  const startMs = new Date(startIso).getTime();
  const nowMs = Date.now();
  const elapsed = Math.floor((nowMs - startMs) / 1000);
  return Math.max(0, durationMinutes * 60 - elapsed);
};

// Timer visual state → Tailwind classes (getTimerClass() keeps its '' | 'warning' | 'danger' contract)
const timerClasses: Record<string, string> = {
  '': 'bg-surface-sunken text-ink border-border',
  warning: 'bg-amber-50 text-amber-700 border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-500',
  danger: 'bg-error-50 text-error-600 border-error-500/50 animate-pulse dark:bg-error-500/10 dark:text-error-500',
};

const ActiveTestPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const stateData = location.state as { attemptData: AttemptData; testTitle: string } | null;

  if (!stateData) {
    useEffect(() => {
      showToast('No active quiz session found.', 'warning');
      navigate('/tests');
    }, []);
    return null;
  }

  const { attemptData, testTitle } = stateData;
  const { attempt_id, duration_minutes, questions } = attemptData;

  // --- Persist start time to localStorage so timer survives refresh ---
  const storageKey = `nurturehub_attempt_${attempt_id}`;

  const getPersistedStartTime = (): string => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.startedAt) return parsed.startedAt;
      } catch {
        /* ignore */
      }
    }
    // Use server-provided started_at, or fallback to now
    const startedAt = attemptData.started_at || new Date().toISOString();
    // Persist for future refreshes
    const existing = stored ? JSON.parse(stored) : {};
    localStorage.setItem(storageKey, JSON.stringify({ ...existing, startedAt }));
    return startedAt;
  };

  const startedAt = getPersistedStartTime();
  const initialRemaining = calcRemaining(startedAt, duration_minutes);

  // --- Restore persisted answers ---
  const getPersistedAnswers = (): AnswerState => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.answers) return parsed.answers;
      }
    } catch {
      /* ignore */
    }
    return {};
  };

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>(getPersistedAnswers);
  const [timeRemaining, setTimeRemaining] = useState(initialRemaining);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const timerRef = useRef<any>(null);

  // Persist answers to localStorage whenever they change
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const existing = stored ? JSON.parse(stored) : {};
      localStorage.setItem(storageKey, JSON.stringify({ ...existing, answers }));
    } catch {
      /* ignore */
    }
  }, [answers]);

  // Keyboard Shortcuts navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentIdx > 0) {
        setCurrentIdx(prev => prev - 1);
      } else if (e.key === 'ArrowRight' && currentIdx < questions.length - 1) {
        setCurrentIdx(prev => prev + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIdx, questions.length]);

  // Countdown timer — recalculates from start time each tick for accuracy
  useEffect(() => {
    if (initialRemaining <= 0) {
      handleAutoSubmit();
      return;
    }

    timerRef.current = setInterval(() => {
      const remaining = calcRemaining(startedAt, duration_minutes);
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        handleAutoSubmit();
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleAutoSubmit = async () => {
    showToast("Time's up! Submitting your answers automatically.", 'warning');
    await performSubmission();
  };

  const performSubmission = async () => {
    setIsSubmitting(true);

    // Format answers array
    const formattedAnswers = questions.map(q => {
      const ans = answers[q.id];
      return {
        question_id: q.id,
        selected_option_id: ans ? ans.selected_option_id : null,
        is_marked_for_review: ans ? ans.is_marked_for_review : false,
      };
    });

    const timeUsed = duration_minutes * 60 - timeRemaining;

    try {
      const response = await submitAttempt(attempt_id, {
        answers: formattedAnswers,
        time_used_seconds: timeUsed,
      });

      showToast('Assessment submitted successfully!', 'success');
      navigate(`/tests/${id}/submitted`, { state: { resultData: response, testTitle } });
    } catch (err: any) {
      showToast('Error submitting quiz answers. Please try again.', 'error');
      setIsSubmitting(false);
      setShowConfirm(false);
    }
  };

  const handleSelectOption = (questionId: number, optionId: number) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        selected_option_id: optionId,
        is_marked_for_review: prev[questionId]?.is_marked_for_review || false,
      },
    }));
  };

  const handleToggleReview = (questionId: number) => {
    setAnswers(prev => {
      const current = prev[questionId];
      return {
        ...prev,
        [questionId]: {
          selected_option_id: current ? current.selected_option_id : null,
          is_marked_for_review: current ? !current.is_marked_for_review : true,
        },
      };
    });
  };

  const handleClearAnswer = (questionId: number) => {
    setAnswers(prev => {
      const copy = { ...prev };
      if (copy[questionId]) {
        copy[questionId] = {
          selected_option_id: null,
          is_marked_for_review: copy[questionId].is_marked_for_review,
        };
      }
      return copy;
    });
  };

  const getTimerClass = () => {
    if (timeRemaining <= 60) return 'danger'; // 1 minute
    if (timeRemaining <= 300) return 'warning'; // 5 minutes
    return '';
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentQuestion = questions[currentIdx];
  const totalQuestions = questions.length;
  const answeredCount = Object.values(answers).filter(a => a.selected_option_id !== null).length;
  const reviewCount = Object.values(answers).filter(a => a.is_marked_for_review).length;
  const unansweredCount = totalQuestions - answeredCount;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Active Assessment</span>
          <h3 className="font-display text-lg font-bold text-ink">{testTitle}</h3>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3.5 py-2 font-bold',
              timerClasses[getTimerClass()],
            )}
          >
            <Clock className="size-4" />
            <span className="font-mono text-lg">{formatTime(timeRemaining)}</span>
          </div>

          <Button onClick={() => setShowConfirm(true)}>Finish Test</Button>
        </div>
      </div>

      {/* Counter */}
      <div className="rounded-lg bg-surface-sunken px-4 py-2 text-center text-sm font-semibold text-ink-muted">
        Question {currentIdx + 1} of {totalQuestions}
      </div>

      {/* Work area */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Question card */}
        <Card className="flex flex-col justify-between p-6">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display font-bold text-ink">Question {currentIdx + 1}</span>
              <span className="rounded-full bg-coral-50 px-3 py-1 text-xs font-bold text-coral-700 dark:bg-coral-500/15 dark:text-coral-300">
                Marks: {currentQuestion.marks}
              </span>
            </div>

            <h3 className="mb-5 text-lg font-semibold leading-relaxed text-ink">{currentQuestion.text}</h3>

            {/* Options */}
            <div className="flex flex-col gap-3">
              {currentQuestion.options.map(opt => {
                const isSelected = answers[currentQuestion.id]?.selected_option_id === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleSelectOption(currentQuestion.id, opt.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-coral-50 dark:bg-coral-500/10'
                        : 'border-border hover:border-border-strong hover:bg-surface-sunken/50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        isSelected ? 'bg-primary text-primary-fg' : 'bg-surface-sunken text-ink-muted',
                      )}
                    >
                      {opt.label}
                    </span>
                    <span className="text-sm text-ink">{opt.text}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom actions */}
          <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={!!answers[currentQuestion.id]?.is_marked_for_review}
                  onChange={() => handleToggleReview(currentQuestion.id)}
                  className="size-4 accent-amber-500"
                />
                <span className="flex items-center gap-1">
                  <Eye className="size-4" /> Mark for Review
                </span>
              </label>

              {answers[currentQuestion.id]?.selected_option_id !== null && (
                <button
                  onClick={() => handleClearAnswer(currentQuestion.id)}
                  className="text-sm font-semibold text-ink-muted hover:text-error-500 cursor-pointer"
                >
                  Clear Selection
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx(prev => prev - 1)}
                iconLeft={<ChevronLeft className="size-4" />}
              >
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentIdx === questions.length - 1}
                onClick={() => setCurrentIdx(prev => prev + 1)}
                iconRight={<ChevronRight className="size-4" />}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>

        {/* Question map */}
        <Card className="p-5">
          <h4 className="mb-4 font-display font-bold text-ink">Questions Map</h4>

          <div className="grid grid-cols-6 gap-2 lg:grid-cols-5">
            {questions.map((q, idx) => {
              const ansState = answers[q.id];
              const isCurrent = idx === currentIdx;
              const isAnswered = ansState?.selected_option_id !== null && ansState?.selected_option_id !== undefined;
              const isMarked = ansState?.is_marked_for_review;

              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentIdx(idx)}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-lg text-sm font-bold transition-colors',
                    isCurrent
                      ? 'bg-primary text-primary-fg ring-2 ring-primary ring-offset-2 ring-offset-surface'
                      : isMarked
                        ? 'bg-amber-500 text-white'
                        : isAnswered
                          ? 'bg-sage-500 text-white'
                          : 'bg-surface-sunken text-ink-muted hover:bg-border',
                  )}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-sage-500" /> Answered
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-amber-500" /> Marked for Review
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-surface-sunken ring-1 ring-border-strong" /> Unanswered
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-primary" /> Current Question
            </span>
          </div>
        </Card>
      </div>

      {/* Confirm modal */}
      <Modal
        open={showConfirm}
        onClose={() => !isSubmitting && setShowConfirm(false)}
        title="Submit Assessment?"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting}>
              Go Back
            </Button>
            <Button onClick={() => performSubmission()} loading={isSubmitting}>
              {isSubmitting ? 'Submitting...' : 'Submit Assessment'}
            </Button>
          </>
        }
      >
        <div className="mb-4 flex gap-3 text-primary">
          <AlertCircle className="size-6 shrink-0" />
          <p className="text-sm text-ink-muted">Are you sure you want to finish and submit your answers?</p>
        </div>

        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-ink-muted">Total Questions:</dt>
          <dd className="text-right font-bold text-ink">{totalQuestions}</dd>
          <dt className="text-ink-muted">Answered:</dt>
          <dd className="text-right font-bold text-primary">{answeredCount}</dd>
          <dt className="text-ink-muted">Flagged for Review:</dt>
          <dd className="text-right font-bold text-amber-600">{reviewCount}</dd>
          <dt className="text-ink-muted">Unanswered:</dt>
          <dd className={cn('text-right font-bold', unansweredCount > 0 ? 'text-error-500' : 'text-ink-faint')}>
            {unansweredCount}
          </dd>
        </dl>
      </Modal>
    </div>
  );
};

export default ActiveTestPage;
