import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
        showToast('Failed to load assessment specifications', 'error');
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
    const toastId = showToast('Initializing active assessment session...', 'loading');

    try {
      const attemptData = await startAttempt(test.id);
      updateToast(toastId, 'Assessment session started! Good luck.', 'success');
      navigate(`/tests/${test.id}/take`, { state: { attemptData, testTitle: test.title } });
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to start quiz attempt';
      updateToast(toastId, msg, 'error');
      setStarting(false);
    }
  };

  if (loading) return <PageLoader label="Loading assessment settings…" />;
  if (!test) return null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/tests')}
          iconLeft={<ChevronLeft className="size-4" />}
        >
          Back to Assessments
        </Button>
      </div>

      <Card className="p-8 sm:p-9">
        <span className="text-xs font-bold uppercase tracking-wider text-primary">Instructions &amp; Regulations</span>
        <h2 className="mt-1 mb-4 font-display text-3xl font-extrabold text-ink">{test.title}</h2>
        <p className="mb-8 text-[15px] leading-relaxed text-ink-muted">{test.description}</p>

        {/* Specs */}
        <div className="mb-8 grid grid-cols-1 gap-5 rounded-xl border border-border bg-surface-sunken p-5 sm:grid-cols-3">
          <Spec label="Questions Count" icon={<HelpCircle className="size-[18px]" />} value={`${test.total_questions} Questions`} />
          <Spec label="Duration Limit" icon={<Clock className="size-[18px]" />} value={`${test.duration_minutes} Minutes`} />
          <Spec label="Passing Threshold" icon={<CheckSquare className="size-[18px]" />} value={`${test.passing_score_pct}% Score`} />
        </div>

        {/* Guidelines */}
        <div className="mb-9 flex flex-col gap-4">
          <h4 className="font-display text-base font-bold text-ink">Important Guidelines:</h4>
          <ul className="flex list-disc flex-col gap-3 pl-5 text-sm leading-relaxed text-ink-muted">
            <li>Ensure you have a stable network connection before starting.</li>
            <li>
              Once you click <strong className="text-ink">Start</strong>, the active countdown timer will begin and
              cannot be paused.
            </li>
            <li>
              You can flag questions using the <strong className="text-ink">Mark for Review</strong> toggle to skip and
              revisit them later.
            </li>
            <li>Do not close or refresh this tab during the quiz, as this will submit your answers automatically.</li>
            <li>
              Upon passing this assessment with a score of{' '}
              <strong className="text-ink">{test.passing_score_pct}% or higher</strong>, the next phase of your training
              will unlock.
            </li>
          </ul>
        </div>

        {/* Warning */}
        <Alert variant="warning" title="Attempt limits" className="mb-9">
          You have completed {test.attempts_count} of your {test.max_attempts} allowed attempts for this assessment.
          Make sure you have reviewed all Stage videos carefully.
        </Alert>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button variant="outline" size="lg" onClick={() => navigate('/tests')} disabled={starting}>
            Cancel
          </Button>
          <Button size="lg" onClick={handleStart} loading={starting}>
            {starting ? 'Starting...' : 'Start Assessment'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default TestInstructionsPage;
