import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { Award, CalendarClock, Clock, Eye, HelpCircle, Lock, Play, RotateCcw } from 'lucide-react';
import type { TestTopicReport } from '../../api/results';
import { Badge, Button, Card } from '../ui';
import TestTopicsCard from './TestTopicsCard';

export interface PhaseTest {
  id: number;
  title: string;
  description: string;
  total_questions: number;
  duration_minutes: number;
  passing_score_pct: number;
  max_attempts: number;
  status: 'draft' | 'scheduled' | 'active' | 'ended';
  test_type: 'formative' | 'screening' | null;
  scheduled_at: string | null;
  is_locked: boolean;
  lock_reason: string | null;
  best_score: number | null;
  attempts_count: number;
  is_passed: boolean;
}

export interface PhaseAttempt {
  id: number;
  test_id: number;
  attempt_number: number;
  submitted_at: string;
  score: number;
  is_passed: boolean;
  time_used_seconds: number;
}

const formatScheduled = (iso: string | null, t: TFunction): string => {
  if (!iso) return t('list.toBeAnnounced');
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const Info: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 text-ink-muted">
    <span className="text-ink-faint">{icon}</span>
    <span>{children}</span>
  </div>
);

/**
 * A test phase inside Tutorials & Tests (review of 18 Oct 2026: "tutorials
 * and tests should be in a single column … phase 1, phase 2, phase 3 — the
 * test-related thing will have its inferences here only"). What the old
 * Tests page showed for the test, its attempts with their reviews, and the
 * learner's topic-wise score.
 */
const TestPhaseCard: React.FC<{
  test: PhaseTest;
  attempts: PhaseAttempt[];
  report?: TestTopicReport;
}> = ({ test, attempts, report }) => {
  const { t } = useTranslation('tests');
  const navigate = useNavigate();
  const typeLabel = test.test_type === 'formative' ? t('list.formativeTest')
    : test.test_type === 'screening' ? t('list.screeningTest') : t('list.test');
  const outOfAttempts = test.attempts_count >= test.max_attempts && !test.is_passed;

  return (
    <Card locked={test.is_locked && attempts.length === 0} className={`flex flex-col gap-4 p-4 sm:p-6 ${test.is_passed ? 'border-success-500' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-primary-ink">{typeLabel}</span>
          <h4 className="mt-0.5 font-display text-lg font-bold leading-tight text-ink">{test.title}</h4>
          {test.description && <p className="mt-1 text-[13px] leading-snug text-ink-muted">{test.description}</p>}
        </div>
        {test.is_passed ? (
          <Badge variant="success">{t('list.badge.passed')}</Badge>
        ) : test.status === 'active' && !test.is_locked ? (
          <Badge variant="success">● {t('list.badge.live')}</Badge>
        ) : test.status === 'ended' ? (
          <Badge variant="neutral">{t('list.badge.ended')}</Badge>
        ) : test.is_locked ? (
          <Badge variant="error"><Lock className="size-2.5" /> {t('list.badge.locked')}</Badge>
        ) : (
          <Badge variant="neutral">{t('list.badge.awaitingStart')}</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-[13px] sm:grid-cols-4">
        <Info icon={<HelpCircle className="size-4" />}>{t('list.questionsCount', { total: test.total_questions })}</Info>
        <Info icon={<Clock className="size-4" />}>{t('list.minutesLimit', { minutes: test.duration_minutes })}</Info>
        <Info icon={<Award className="size-4" />}>{t('list.passMark', { pct: test.passing_score_pct })}</Info>
        <Info icon={<RotateCcw className="size-4" />}>{t('list.attempts', { used: test.attempts_count, max: test.max_attempts })}</Info>
      </div>

      {test.status !== 'active' && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-sunken px-3 py-2.5 text-[13px] text-ink-muted">
          <CalendarClock className="size-4 shrink-0 text-primary-ink" />
          <span>
            {test.status === 'ended' ? t('list.testEnded') : (
              <>{t('list.tentativeDate')} <strong className="text-ink">{formatScheduled(test.scheduled_at, t)}</strong></>
            )}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-ink-muted">
          {test.best_score !== null && (
            <>{t('list.bestScore')}{' '}
              <strong className={test.is_passed ? 'text-success-600' : 'text-error-600'}>{test.best_score.toFixed(0)}%</strong></>
          )}
        </span>
        {test.is_locked ? (
          attempts.length === 0 && (
            <span className="flex items-center gap-1 text-right text-xs text-ink-faint">
              <Lock className="size-3 shrink-0" /> {test.lock_reason || t('list.notAvailableShort')}
            </span>
          )
        ) : outOfAttempts ? (
          <span className="text-xs font-semibold text-error-600">{t('list.maxAttempts')}</span>
        ) : (
          <Button
            size="sm"
            variant={test.is_passed ? 'outline' : 'primary'}
            onClick={() => navigate(`/tests/${test.id}/instructions`)}
            iconLeft={test.is_passed ? undefined : <Play className="size-3 fill-current stroke-none" />}
          >
            {test.is_passed ? t('list.retake') : t('common.startAssessment')}
          </Button>
        )}
      </div>

      {attempts.length > 0 && (
        <div className="border-t border-border pt-3">
          <h5 className="mb-2 text-sm font-bold text-ink">{t('list.yourAttempts')}</h5>
          <ul className="flex flex-col gap-2">
            {attempts.map(att => (
              <li key={att.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/results/${att.id}`)}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] transition-colors hover:border-border-strong"
                >
                  <span className="font-semibold text-ink">{t('list.attemptNumber', { n: att.attempt_number })}</span>
                  <span className={`font-bold ${att.is_passed ? 'text-success-600' : 'text-error-600'}`}>{att.score.toFixed(0)}%</span>
                  <Badge variant={att.is_passed ? 'success' : 'error'} size="sm">{att.is_passed ? t('list.pass') : t('list.fail')}</Badge>
                  <span className="text-ink-muted">{new Date(att.submitted_at).toLocaleDateString('en-GB')}</span>
                  <span className="ml-auto inline-flex items-center gap-1 font-semibold text-primary-ink"><Eye className="size-3.5" />{t('list.review')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report && (
        <div className="border-t border-border pt-3">
          <h5 className="mb-2 text-sm font-bold text-ink">{t('topics.title')}</h5>
          <TestTopicsCard report={report} showTitle={false} />
        </div>
      )}
    </Card>
  );
};

export default TestPhaseCard;
