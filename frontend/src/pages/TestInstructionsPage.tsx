import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { getTestDetails, startAttempt } from '../api/tests';
import { useToast } from '../context/ToastContext';
import { Clock, HelpCircle, ChevronLeft, CheckSquare } from 'lucide-react';
import { Alert, Button, Card, PageLoader } from '../components/ui';

interface Test {
  id: number;
  stage_id: number;
  title: string;
  description: string;
  total_questions: number;
  duration_minutes: number;
  passing_score_pct: number;
  max_attempts: number;
  status: 'draft' | 'scheduled' | 'active' | 'ended';
  scheduled_at: string | null;
  is_locked: boolean;
  lock_reason: string | null;
  attempts_count: number;
  is_passed: boolean;
}

const Spec: React.FC<{ label: string; icon: React.ReactNode; value: string }> = ({ label, icon, value }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs font-medium text-ink-faint">{label}</span>
    <div className="flex items-center gap-2 text-lg font-bold text-ink">
      <span className="text-primary">{icon}</span>
      <span>{value}</span>
    </div>
  </div>
);

const TestInstructionsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('tests');
  const { showToast, updateToast } = useToast();

  const [test, setTest] = useState<Test | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const data = await getTestDetails(Number(id));
        setTest(data);
      } catch {
        showToast(t('instructions.toastLoadFailed'), 'error');
        navigate('/tests');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [id]);

  const handleStart = async () => {
    if (!test) return;
    setStarting(true);
    const toastId = showToast(t('instructions.toastInitializing'), 'loading');

    try {
      const attemptData = await startAttempt(test.id);
      updateToast(toastId, t('instructions.toastStarted'), 'success');
      navigate(`/tests/${test.id}/take`, { state: { attemptData, testTitle: test.title } });
    } catch (err: any) {
      const msg = err.response?.data?.detail || t('instructions.toastStartFailed');
      updateToast(toastId, msg, 'error');
      setStarting(false);
    }
  };

  if (loading) return <PageLoader label={t('instructions.loading')} />;
  if (!test) return null;

  const startLabel = starting
    ? t('instructions.starting')
    : test.is_locked
      ? test.status !== 'active'
        ? t('instructions.notStartedByAdmin')
        : t('instructions.locked')
      : t('common.startAssessment');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/tests')}
          iconLeft={<ChevronLeft className="size-4" />}
        >
          {t('common.backToAssessments')}
        </Button>
      </div>

      <Card className="p-8 sm:p-9">
        <span className="text-xs font-bold uppercase tracking-wider text-primary">{t('instructions.eyebrow')}</span>
        <h2 className="mt-1 mb-4 font-display text-3xl font-extrabold text-ink">{test.title}</h2>
        <p className="mb-8 text-[15px] leading-relaxed text-ink-muted">{test.description}</p>

        {/* Specs */}
        <div className="mb-8 grid grid-cols-1 gap-5 rounded-xl border border-border bg-surface-sunken p-5 sm:grid-cols-3">
          <Spec
            label={t('instructions.specQuestionsLabel')}
            icon={<HelpCircle className="size-[18px]" />}
            value={t('instructions.specQuestionsValue', { total: test.total_questions })}
          />
          <Spec
            label={t('instructions.specDurationLabel')}
            icon={<Clock className="size-[18px]" />}
            value={t('instructions.specDurationValue', { minutes: test.duration_minutes })}
          />
          <Spec
            label={t('instructions.specPassingLabel')}
            icon={<CheckSquare className="size-[18px]" />}
            value={t('instructions.specPassingValue', { pct: test.passing_score_pct })}
          />
        </div>

        {/* Guidelines */}
        <div className="mb-9 flex flex-col gap-4">
          <h4 className="font-display text-base font-bold text-ink">{t('instructions.guidelinesTitle')}</h4>
          <ul className="flex list-disc flex-col gap-3 pl-5 text-sm leading-relaxed text-ink-muted">
            <li>{t('instructions.guidelines.network')}</li>
            <li>
              <Trans
                t={t}
                i18nKey="instructions.guidelines.timer"
                components={{ strong: <strong className="text-ink" /> }}
              />
            </li>
            <li>
              <Trans
                t={t}
                i18nKey="instructions.guidelines.markReview"
                components={{ strong: <strong className="text-ink" /> }}
              />
            </li>
            <li>{t('instructions.guidelines.noRefresh')}</li>
            <li>
              <Trans
                t={t}
                i18nKey="instructions.guidelines.unlock"
                components={{ strong: <strong className="text-ink" /> }}
                values={{ pct: test.passing_score_pct }}
              />
            </li>
          </ul>
        </div>

        {/* Lock notice */}
        {test.is_locked && (
          <Alert
            variant="info"
            title={test.status !== 'active' ? t('instructions.lockTitleNotStarted') : t('instructions.lockTitleLocked')}
            className="mb-9"
          >
            {test.lock_reason || t('instructions.lockBodyDefault')}
          </Alert>
        )}

        {/* Warning */}
        <Alert variant="warning" title={t('instructions.attemptLimitsTitle')} className="mb-9">
          {t('instructions.attemptLimitsBody', { used: test.attempts_count, max: test.max_attempts })}
        </Alert>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button variant="outline" size="lg" onClick={() => navigate('/tests')} disabled={starting}>
            {t('instructions.cancel')}
          </Button>
          <Button
            size="lg"
            onClick={handleStart}
            loading={starting}
            disabled={starting || test.is_locked}
            title={test.is_locked ? test.lock_reason || t('instructions.notAvailableShort') : undefined}
          >
            {startLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default TestInstructionsPage;
