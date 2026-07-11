import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDetailedResult } from '../api/results';
import { useToast } from '../context/ToastContext';
import { CheckCircle, XCircle, Clock, Award, ChevronLeft, HelpCircle } from 'lucide-react';
import { Badge, Button, Card, PageLoader } from '../components/ui';
import { cn } from '../utils/cn';

interface Option {
  id: number;
  label: string;
  text: string;
}

interface DetailedAnswer {
  question_id: number;
  question_text: string;
  selected_option_id: number | null;
  correct_option_id: number;
  is_correct: boolean;
  options: Option[];
}

interface Attempt {
  id: number;
  test_id: number;
  attempt_number: number;
  started_at: string;
  submitted_at: string;
  score: number;
  total_marks: number;
  is_passed: boolean;
  time_used_seconds: number;
}

interface DetailedResult {
  attempt: Attempt;
  test_title: string;
  passing_score_pct: number;
  correct_count: number;
  total_questions: number;
  answers: DetailedAnswer[];
}

const StatItem: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({
  icon,
  label,
  value,
}) => (
  <div className="flex items-center gap-2.5">
    <span className="text-primary">{icon}</span>
    <div>
      <span className="block text-xs text-ink-faint">{label}</span>
      <strong className="text-[15px] text-ink">{value}</strong>
    </div>
  </div>
);

const ResultsPage: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [result, setResult] = useState<DetailedResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResult = async () => {
      try {
        const data = await getDetailedResult(Number(attemptId));
        setResult(data);
      } catch {
        showToast('Failed to load performance report details', 'error');
        navigate('/tests');
      } finally {
        setLoading(false);
      }
    };
    fetchResult();
  }, [attemptId]);

  if (loading) return <PageLoader label="Loading performance scorecard…" />;
  if (!result) return null;

  const { attempt, test_title, passing_score_pct, correct_count, total_questions, answers } = result;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="print-hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/tests')}
          iconLeft={<ChevronLeft className="size-4" />}
        >
          Back to Assessments
        </Button>
      </div>

      {/* Summary */}
      <Card className="p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Performance Report • Attempt #{attempt.attempt_number}
            </span>
            <h2 className="mt-1 mb-2 font-display text-3xl font-extrabold text-ink">{test_title}</h2>
            <p className="text-sm text-ink-muted">
              Submitted on {new Date(attempt.submitted_at).toLocaleDateString()} at{' '}
              {new Date(attempt.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="block text-xs text-ink-faint">Score</span>
              <span
                className={cn(
                  'font-display text-4xl font-extrabold leading-none',
                  attempt.is_passed ? 'text-success-600' : 'text-error-600',
                )}
              >
                {attempt.score.toFixed(0)}%
              </span>
            </div>
            <Badge variant={attempt.is_passed ? 'success' : 'error'} size="md">
              {attempt.is_passed ? 'PASSED' : 'FAILED'}
            </Badge>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-7 grid grid-cols-1 gap-5 rounded-xl border border-border bg-surface-sunken p-5 sm:grid-cols-3">
          <StatItem
            icon={<Award className="size-5" />}
            label="Result Breakdown"
            value={`${correct_count} / ${total_questions} Correct`}
          />
          <StatItem
            icon={<Clock className="size-5" />}
            label="Time Elapsed"
            value={`${Math.floor(attempt.time_used_seconds / 60)}m ${attempt.time_used_seconds % 60}s`}
          />
          <StatItem
            icon={<HelpCircle className="size-5" />}
            label="Required Score"
            value={`${passing_score_pct}% Pass Mark`}
          />
        </div>
      </Card>

      {/* Answer review */}
      <div className="flex flex-col gap-6">
        <h3 className="font-display text-xl font-bold text-ink">Answer Key &amp; Explanations Review</h3>

        {answers.map((ans, idx) => (
          <Card
            key={ans.question_id}
            className={cn(
              'border-l-4 p-7',
              ans.selected_option_id === null
                ? 'border-l-border-strong'
                : ans.is_correct
                  ? 'border-l-success-500'
                  : 'border-l-error-500',
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-base font-extrabold text-primary">Question {idx + 1}</span>

              {ans.selected_option_id === null ? (
                <Badge variant="neutral">Not Attempted</Badge>
              ) : ans.is_correct ? (
                <Badge variant="success">
                  <CheckCircle className="size-3" /> Correct
                </Badge>
              ) : (
                <Badge variant="error">
                  <XCircle className="size-3" /> Incorrect
                </Badge>
              )}
            </div>

            <h4 className="mb-5 text-[17px] font-semibold leading-snug text-ink">{ans.question_text}</h4>

            <div className="flex flex-col gap-2.5">
              {ans.options.map(opt => {
                const isSelected = ans.selected_option_id === opt.id;
                const isCorrect = ans.correct_option_id === opt.id;
                const indicator = isCorrect ? ' (Correct Option)' : isSelected ? ' (Your Answer)' : '';

                return (
                  <div
                    key={opt.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 text-sm',
                      isCorrect
                        ? 'border-success-500 bg-success-50 font-semibold text-success-600 dark:bg-success-500/10'
                        : isSelected
                          ? 'border-error-500 bg-error-50 font-semibold text-error-600 dark:bg-error-500/10'
                          : 'border-border bg-surface text-ink',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                        isCorrect
                          ? 'border-success-500 bg-success-500 text-white'
                          : isSelected
                            ? 'border-error-500 bg-error-500 text-white'
                            : 'border-border-strong text-ink-muted',
                      )}
                    >
                      {opt.label}
                    </span>
                    <span>
                      {opt.text}
                      {indicator}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ResultsPage;
