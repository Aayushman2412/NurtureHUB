import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getDetailedResult, type TestTopicReport } from '../api/results';
import { useToast } from '../context/ToastContext';
import { CheckCircle, XCircle, Clock, Award, ChevronLeft, HelpCircle, Lock } from 'lucide-react';
import { Badge, Button, Card, Chip, PageLoader, Select } from '../components/ui';
import TestTopicsCard from '../components/tests/TestTopicsCard';
import { cn } from '../utils/cn';

interface Option {
  id: number;
  label: string;
  text: string;
}

interface DetailedAnswer {
  question_id: number;
  question_text: string;
  topic?: string | null;
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
  /** False while the admin holds the answers back (review of 19 Oct 2026). */
  answers_released?: boolean;
  answers: DetailedAnswer[];
}

const StatItem: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({
  icon,
  label,
  value,
}) => (
  <div className="flex items-center gap-2.5">
    <span className="text-primary-ink">{icon}</span>
    <div>
      <span className="block text-xs text-ink-faint">{label}</span>
      <strong className="text-[15px] text-ink">{value}</strong>
    </div>
  </div>
);

const ResultsPage: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('tests');
  const { showToast } = useToast();

  const [result, setResult] = useState<DetailedResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Feedback by topic (review of 18 Oct 2026: "make sure there are filters of
  // the topic, or the correct or the wrong answer").
  const [topicFilter, setTopicFilter] = useState<string>('');
  const [answerFilter, setAnswerFilter] = useState<'all' | 'right' | 'wrong'>('all');

  useEffect(() => {
    const fetchResult = async () => {
      try {
        const data = await getDetailedResult(Number(attemptId));
        setResult(data);
      } catch {
        showToast(t('results.toastLoadFailed'), 'error');
        navigate('/tutorials');
      } finally {
        setLoading(false);
      }
    };
    fetchResult();
  }, [attemptId]);

  const report = useMemo<TestTopicReport | null>(() => {
    if (!result) return null;
    const groups = new Map<string | null, { correct: number; total: number }>();
    for (const a of result.answers) {
      const key = a.topic?.trim() || null;
      const g = groups.get(key) ?? { correct: 0, total: 0 };
      g.total += 1;
      g.correct += a.is_correct ? 1 : 0;
      groups.set(key, g);
    }
    const topics = [...groups.entries()]
      .map(([topic, g]) => ({ topic, ...g, pct: g.total ? Math.round((1000 * g.correct) / g.total) / 10 : null }))
      .sort((x, y) => Number(x.topic == null) - Number(y.topic == null) || (x.pct ?? 101) - (y.pct ?? 101));
    const named = topics.filter(r => r.topic);
    return {
      test_id: result.attempt.test_id, title: result.test_title, test_type: null, status: '', stage_id: 0,
      attempt_id: result.attempt.id, attempt_number: result.attempt.attempt_number, score: result.attempt.score,
      is_passed: result.attempt.is_passed, passing_score_pct: result.passing_score_pct,
      correct: result.correct_count, total: result.total_questions, topics,
      strong: [...named].sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0)).filter(r => (r.pct ?? 0) >= 80).map(r => r.topic!),
      weak: named.filter(r => (r.pct ?? 0) < result.passing_score_pct).map(r => r.topic!),
      videos: named.filter(r => (r.pct ?? 0) < result.passing_score_pct).map(r => ({ topic: r.topic!, videos: [] })),
    };
  }, [result]);

  if (loading) return <PageLoader label={t('results.loading')} />;
  if (!result) return null;

  const { attempt, test_title, passing_score_pct, correct_count, total_questions, answers } = result;
  const topicNames = [...new Set(answers.map(a => a.topic?.trim()).filter((x): x is string => !!x))].sort();
  const numbered = answers.map((ans, idx) => ({ ans, n: idx + 1 }));
  const shown = numbered.filter(({ ans }) =>
    (!topicFilter || (ans.topic?.trim() || '') === topicFilter)
    && (answerFilter === 'all' || (answerFilter === 'right' ? ans.is_correct : !ans.is_correct)));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="print-hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/tutorials')}
          iconLeft={<ChevronLeft className="size-4" />}
        >
          {t('common.backToAssessments')}
        </Button>
      </div>

      {/* Summary */}
      <Card className="p-4 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary-ink">
              {t('results.reportEyebrow', { n: attempt.attempt_number })}
            </span>
            <h2 className="mt-1 mb-2 font-display text-2xl font-extrabold text-ink sm:text-3xl">{test_title}</h2>
            <p className="text-sm text-ink-muted">
              {t('results.submittedOn', {
                date: new Date(attempt.submitted_at).toLocaleDateString('en-GB'),
                time: new Date(attempt.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="block text-xs text-ink-faint">{t('results.score')}</span>
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
              {attempt.is_passed ? t('common.passed') : t('common.failed')}
            </Badge>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-7 grid grid-cols-1 gap-5 rounded-xl border border-border bg-surface-sunken p-5 sm:grid-cols-3">
          <StatItem
            icon={<Award className="size-5" />}
            label={t('results.breakdownLabel')}
            value={t('results.breakdownValue', { correct: correct_count, total: total_questions })}
          />
          <StatItem
            icon={<Clock className="size-5" />}
            label={t('results.timeLabel')}
            value={t('time.minsSecs', {
              mins: Math.floor(attempt.time_used_seconds / 60),
              secs: attempt.time_used_seconds % 60,
            })}
          />
          <StatItem
            icon={<HelpCircle className="size-5" />}
            label={t('results.requiredLabel')}
            value={t('results.requiredValue', { pct: passing_score_pct })}
          />
        </div>
      </Card>

      {/* Score by topic, with what to watch again */}
      {report && topicNames.length > 0 && (
        <Card className="p-4 sm:p-6">
          <h3 className="mb-3 font-display text-lg font-bold text-ink">{t('topics.title')}</h3>
          <TestTopicsCard report={report} showTitle={false} />
        </Card>
      )}

      {/* Answer review — closed until the admin releases the answers, so a
          group that sits the same paper again later cannot read them first
          (review of 19 Oct 2026). */}
      {result.answers_released === false ? (
        <Card className="flex items-start gap-3 p-4 sm:p-6">
          <Lock className="mt-0.5 size-5 shrink-0 text-ink-muted" />
          <div>
            <h3 className="font-display text-lg font-bold text-ink">{t('results.answerReview')}</h3>
            <p className="mt-1 text-sm text-ink-muted">{t('results.answersHeld')}</p>
          </div>
        </Card>
      ) : (
      <div className="flex flex-col gap-6">
        <h3 className="font-display text-xl font-bold text-ink">{t('results.answerReview')}</h3>

        {/* The filters stay in view while scrolling the questions (19 Oct 2026). */}
        <div className="sticky top-[3.75rem] z-20 -mx-5 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-5 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 print-hidden">
          {topicNames.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              {t('topics.filterTopic')}
              <Select value={topicFilter} onChange={e => setTopicFilter(e.target.value)} className="min-w-44">
                <option value="">{t('topics.allTopics')}</option>
                {topicNames.map(name => <option key={name} value={name}>{name}</option>)}
              </Select>
            </label>
          )}
          <span className="flex items-center gap-2 text-sm text-ink-muted">
            {t('topics.filterAnswer')}
            {(['all', 'right', 'wrong'] as const).map(k => (
              <Chip key={k} selected={answerFilter === k} onClick={() => setAnswerFilter(k)}>
                {t(k === 'all' ? 'topics.allAnswers' : k === 'right' ? 'topics.onlyRight' : 'topics.onlyWrong')}
              </Chip>
            ))}
          </span>
        </div>

        {shown.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-faint">{t('topics.noneMatch')}</p>
        )}

        {shown.map(({ ans, n }) => (
          <Card
            key={ans.question_id}
            className={cn(
              'border-l-4 p-4 sm:p-7',
              ans.selected_option_id === null
                ? 'border-l-border-strong'
                : ans.is_correct
                  ? 'border-l-success-500'
                  : 'border-l-error-500',
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-base font-extrabold text-primary-ink">
                {t('common.question', { n })}
                {ans.topic && <span className="ml-2 align-middle text-xs font-semibold text-ink-muted">· {ans.topic}</span>}
              </span>

              {ans.selected_option_id === null ? (
                <Badge variant="neutral">{t('results.notAttempted')}</Badge>
              ) : ans.is_correct ? (
                <Badge variant="success">
                  <CheckCircle className="size-3" /> {t('results.correct')}
                </Badge>
              ) : (
                <Badge variant="error">
                  <XCircle className="size-3" /> {t('results.incorrect')}
                </Badge>
              )}
            </div>

            <h4 className="mb-5 text-[17px] font-semibold leading-snug text-ink">{ans.question_text}</h4>

            <div className="flex flex-col gap-2.5">
              {ans.options.map(opt => {
                const isSelected = ans.selected_option_id === opt.id;
                const isCorrect = ans.correct_option_id === opt.id;
                const indicator = isCorrect
                  ? ` ${t('results.correctOption')}`
                  : isSelected
                    ? ` ${t('results.yourAnswer')}`
                    : '';

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
      )}
    </div>
  );
};

export default ResultsPage;
