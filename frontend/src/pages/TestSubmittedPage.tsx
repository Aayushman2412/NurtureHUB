import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { CheckCircle2, Award, ArrowRight, BarChart2 } from 'lucide-react';
import { Badge, Button, Card } from '../components/ui';
import { CONFETTI_COLORS } from '../utils/brandColors';

interface ResultData {
  attempt_id: number;
  score: number;
  total_marks: number;
  is_passed: boolean;
  correct_answers_count: number;
  total_questions: number;
}

const TestSubmittedPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useTranslation('tests');

  const stateData = location.state as { resultData: ResultData; testTitle: string } | null;

  if (!stateData) {
    useEffect(() => {
      showToast(t('submitted.toastNoDetails'), 'warning');
      navigate('/tests');
    }, []);
    return null;
  }

  const { resultData, testTitle } = stateData;
  const { attempt_id, score, is_passed, correct_answers_count, total_questions } = resultData;

  // Trigger confetti on mount (only on pass — keeps celebratory intent honest)
  useEffect(() => {
    if (!is_passed) return;
    const elements: HTMLDivElement[] = [];

    for (let i = 0; i < 65; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti-piece';
      confetti.style.left = Math.random() * 100 + 'vw';
      confetti.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      confetti.style.animationDuration = Math.random() * 2 + 2.2 + 's';
      confetti.style.animationDelay = Math.random() * 1.5 + 's';
      confetti.style.width = Math.random() * 8 + 6 + 'px';
      confetti.style.height = Math.random() * 8 + 6 + 'px';
      confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';

      document.body.appendChild(confetti);
      elements.push(confetti);
    }

    return () => {
      elements.forEach(el => el.remove());
    };
  }, [is_passed]);

  return (
    <div className="mx-auto my-10 flex max-w-xl flex-col gap-8 text-center">
      <Card className="flex flex-col items-center gap-6 p-10">
        {/* Status icon */}
        <div
          className={`flex size-20 items-center justify-center rounded-full shadow-(--shadow-card) ${
            is_passed
              ? 'bg-success-50 text-success-500 dark:bg-success-500/15'
              : 'bg-error-50 text-error-500 dark:bg-error-500/15'
          }`}
        >
          {is_passed ? <CheckCircle2 className="size-11" /> : <Award className="size-11" />}
        </div>

        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary-ink">{t('submitted.eyebrow')}</span>
          <h2 className="mt-1 mb-2 font-display text-3xl font-extrabold text-ink">
            {is_passed ? t('submitted.headingPass') : t('submitted.headingComplete')}
          </h2>
          <p className="text-[15px] text-ink-muted">
            <Trans
              t={t}
              i18nKey="submitted.subtitle"
              components={{ strong: <strong className="text-ink" /> }}
              values={{ title: testTitle }}
            />
          </p>
        </div>

        {/* Metrics */}
        <div className="my-3 flex w-full justify-around border-y border-border py-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-faint">{t('submitted.scoreAchieved')}</span>
            <span className={`font-display text-2xl font-extrabold ${is_passed ? 'text-success-600' : 'text-error-600'}`}>
              {score.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-faint">{t('submitted.correctAnswers')}</span>
            <span className="font-display text-2xl font-extrabold text-ink">
              {correct_answers_count} <span className="text-base font-medium text-ink-faint">/ {total_questions}</span>
            </span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-ink-faint">{t('submitted.outcome')}</span>
            <Badge variant={is_passed ? 'success' : 'error'} size="md">
              {is_passed ? t('common.passed') : t('common.failed')}
            </Badge>
          </div>
        </div>

        <p className="text-[13px] text-ink-faint">
          {is_passed ? t('submitted.messagePass') : t('submitted.messageFail')}
        </p>

        {/* Actions */}
        <div className="mt-3 flex w-full gap-4">
          <Button variant="outline" size="lg" fullWidth onClick={() => navigate('/tests')}>
            {t('submitted.assessmentsList')}
          </Button>
          <Button
            size="lg"
            fullWidth
            onClick={() => navigate(`/results/${attempt_id}`)}
            iconLeft={<BarChart2 className="size-4" />}
            iconRight={<ArrowRight className="size-3.5" />}
            className="flex-[1.5]"
          >
            {t('submitted.viewReport')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default TestSubmittedPage;
