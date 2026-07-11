import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTests } from '../api/tests';
import { getResultsList } from '../api/results';
import { useToast } from '../context/ToastContext';
import { Award, Clock, HelpCircle, Lock, Play, ArrowRight, Eye } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageLoader, Table, TBody, Td, Th, THead, Tr } from '../components/ui';

interface Test {
  id: number;
  stage_id: number;
  title: string;
  description: string;
  total_questions: number;
  duration_minutes: number;
  passing_score_pct: number;
  max_attempts: number;
  is_locked: boolean;
  best_score: number | null;
  attempts_count: number;
  is_passed: boolean;
}

interface Attempt {
  id: number;
  test_id: number;
  attempt_number: number;
  started_at: string;
  submitted_at: string;
  score: number;
  is_passed: boolean;
  time_used_seconds: number;
}

const InfoItem: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 text-ink-muted">
    <span className="text-ink-faint">{icon}</span>
    <span>{children}</span>
  </div>
);

const TestsPage: React.FC = () => {
  const [tests, setTests] = useState<Test[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);

  const { showToast } = useToast();
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      const [testsData, attemptsData] = await Promise.all([getTests(), getResultsList()]);
      setTests(testsData);
      setAttempts(attemptsData);
    } catch {
      showToast('Failed to load assessment statistics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleTestClick = (test: Test) => {
    if (test.is_locked) {
      showToast('Complete all video lessons in this training stage to unlock this assessment.', 'warning');
      return;
    }
    navigate(`/tests/${test.id}/instructions`);
  };

  const getTestTitle = (testId: number) => tests.find(t => t.id === testId)?.title || 'Assessment';

  if (loading) return <PageLoader label="Loading assessment sheets…" />;

  return (
    <div className="flex flex-col gap-10">
      {/* Assessment cards */}
      <div className="flex flex-col gap-5">
        <h3 className="font-display text-xl font-bold text-ink">Available Assessments</h3>

        {tests.length === 0 ? (
          <EmptyState
            icon={<Award />}
            title="No assessments yet"
            description="Complete a training phase to unlock its assessment."
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {tests.map(test => (
              <Card
                key={test.id}
                locked={test.is_locked}
                className={`flex flex-col justify-between p-6 ${test.is_passed ? 'border-success-500' : ''}`}
              >
                <div>
                  <div className="mb-3 flex items-start justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">
                      Stage {test.stage_id} Assessment
                    </span>
                    {test.is_locked ? (
                      <Badge variant="error">
                        <Lock className="size-2.5" /> Locked
                      </Badge>
                    ) : test.is_passed ? (
                      <Badge variant="success">Passed ✓</Badge>
                    ) : (
                      <Badge variant="success">Unlocked</Badge>
                    )}
                  </div>

                  <h4 className="mb-2 font-display text-lg font-bold leading-tight text-ink">{test.title}</h4>
                  <p className="mb-5 text-[13px] leading-snug text-ink-muted">{test.description}</p>

                  <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 text-[13px]">
                    <InfoItem icon={<HelpCircle className="size-4" />}>{test.total_questions} Questions</InfoItem>
                    <InfoItem icon={<Clock className="size-4" />}>{test.duration_minutes} Minutes limit</InfoItem>
                    <InfoItem icon={<Award className="size-4" />}>{test.passing_score_pct}% Pass mark</InfoItem>
                    <InfoItem icon={<Award className="size-4" />}>
                      Attempts: {test.attempts_count} / {test.max_attempts}
                    </InfoItem>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-border pt-4">
                  <div>
                    {test.best_score !== null && (
                      <span className="text-[13px] text-ink-muted">
                        Best Score:{' '}
                        <strong className={test.is_passed ? 'text-success-600' : 'text-error-600'}>
                          {test.best_score.toFixed(1)}%
                        </strong>
                      </span>
                    )}
                  </div>

                  {test.is_locked ? (
                    <span className="flex items-center gap-1 text-xs text-ink-faint">
                      <Lock className="size-3" /> Complete all stage videos
                    </span>
                  ) : test.attempts_count >= test.max_attempts && !test.is_passed ? (
                    <span className="text-xs font-semibold text-error-600">Max attempts reached</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={test.is_passed ? 'outline' : 'primary'}
                      onClick={() => handleTestClick(test)}
                      iconLeft={test.is_passed ? undefined : <Play className="size-3 fill-current stroke-none" />}
                      iconRight={test.is_passed ? <ArrowRight className="size-3.5" /> : undefined}
                    >
                      {test.is_passed ? 'Retake Quiz' : 'Start Assessment'}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div className="flex flex-col gap-5">
        <h3 className="font-display text-xl font-bold text-ink">Assessment History</h3>

        {attempts.length === 0 ? (
          <EmptyState
            icon={<Eye />}
            title="No attempts yet"
            description="Finish a course phase and take a quiz to see reports here."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Assessment Title</Th>
                <Th>Attempt #</Th>
                <Th>Date Submitted</Th>
                <Th>Duration Used</Th>
                <Th>Score</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {attempts.map(att => (
                <Tr key={att.id} clickable onClick={() => navigate(`/results/${att.id}`)}>
                  <Td className="font-semibold">{getTestTitle(att.test_id)}</Td>
                  <Td className="text-ink-muted">Attempt #{att.attempt_number}</Td>
                  <Td className="text-ink-muted">{new Date(att.submitted_at).toLocaleDateString()}</Td>
                  <Td className="text-ink-muted">
                    {Math.floor(att.time_used_seconds / 60)}m {att.time_used_seconds % 60}s
                  </Td>
                  <Td className={`font-bold ${att.is_passed ? 'text-success-600' : 'text-error-600'}`}>
                    {att.score.toFixed(1)}%
                  </Td>
                  <Td>
                    <Badge variant={att.is_passed ? 'success' : 'error'}>{att.is_passed ? 'Pass' : 'Fail'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      iconLeft={<Eye className="size-3" />}
                      onClick={e => {
                        e.stopPropagation();
                        navigate(`/results/${att.id}`);
                      }}
                    >
                      Review
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default TestsPage;
