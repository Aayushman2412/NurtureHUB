import React, { useEffect, useState } from 'react';
import { CheckCircle, HelpCircle } from 'lucide-react';
import { Modal, Button } from '../ui';
import { cn } from '../../utils/cn';
import {
  getTutorialQuiz,
  submitTutorialQuiz,
  skipTutorialQuiz,
} from '../../api/tutorials';
import type { QuizQuestion, QuizResult } from '../../api/tutorials';
import { useToast } from '../../context/ToastContext';

/**
 * Post-tutorial quiz popup. Shown once a tutorial is completed (when the admin
 * has quizzes enabled for it). The user can answer the 3-5 questions or skip —
 * either way the outcome is tracked and reported in admin Tutorial Tracking.
 */

interface TutorialQuizModalProps {
  tutorialId: number;
  tutorialTitle: string;
  onClose: (outcome: 'completed' | 'skipped' | 'dismissed') => void;
}

const TutorialQuizModal: React.FC<TutorialQuizModalProps> = ({
  tutorialId,
  tutorialTitle,
  onClose,
}) => {
  const { showToast } = useToast();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const quiz = await getTutorialQuiz(tutorialId);
        if (!quiz.quiz_available || quiz.questions.length === 0) {
          onClose('dismissed');
          return;
        }
        setQuestions(quiz.questions);
      } catch {
        onClose('dismissed');
      } finally {
        setLoading(false);
      }
    })();
  }, [tutorialId]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await submitTutorialQuiz(
        tutorialId,
        questions.map((q) => ({
          question_id: q.id,
          selected_option_id: answers[q.id] ?? null,
        }))
      );
      setResult(res);
    } catch {
      showToast('Failed to submit quiz answers', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    try {
      await skipTutorialQuiz(tutorialId);
    } catch {
      /* skip failure is non-blocking */
    }
    onClose('skipped');
  };

  if (loading) return null;

  const answeredCount = Object.keys(answers).length;

  return (
    <Modal
      open
      onClose={handleSkip}
      title={
        <span className="flex items-center gap-2">
          <HelpCircle className="size-5 text-primary" /> Quick Check
        </span>
      }
      footer={
        result ? (
          <Button onClick={() => onClose('completed')}>Continue</Button>
        ) : (
          <>
            <Button variant="outline" onClick={handleSkip}>Skip Quiz</Button>
            <Button
              onClick={handleSubmit}
              loading={submitting}
              disabled={answeredCount < questions.length}
            >
              {`Submit Answers (${answeredCount}/${questions.length})`}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="py-4 text-center">
          <CheckCircle className="mx-auto mb-3 size-12 text-success-500" />
          <h3 className="font-display text-xl font-extrabold text-ink">Quiz Submitted!</h3>
          <p className="mt-2 text-ink-muted">
            You answered <strong className="text-ink">{result.correct_count} of {result.total_questions}</strong>{' '}
            questions correctly ({result.score_pct}%).
          </p>
        </div>
      ) : (
        <>
          <p className="mb-5 text-sm text-ink-muted">
            A few questions about “{tutorialTitle}”. Answering helps us confirm your learning —
            you may skip, but skips are recorded.
          </p>
          <div className="flex flex-col gap-5">
            {questions.map((q, qi) => (
              <div key={q.id}>
                <p className="mb-2.5 text-sm font-semibold text-ink">
                  {qi + 1}. {q.text}
                </p>
                <div className="flex flex-col gap-2">
                  {q.options.map((opt) => {
                    const selected = answers[q.id] === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg border-2 px-3.5 py-2.5 text-left text-sm transition-colors',
                          selected
                            ? 'border-primary bg-coral-50 text-ink dark:bg-coral-500/15'
                            : 'border-border bg-surface text-ink hover:bg-surface-sunken'
                        )}
                      >
                        <span className={cn('min-w-4 font-bold', selected ? 'text-primary' : 'text-ink-faint')}>
                          {opt.label}
                        </span>
                        <span>{opt.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};

export default TutorialQuizModal;
