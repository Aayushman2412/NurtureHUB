import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTestDetails, startAttempt } from '../api/tests';
import { useToast } from '../context/ToastContext';
import { Clock, HelpCircle, AlertTriangle, ChevronLeft, CheckSquare } from 'lucide-react';

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

const TestInstructionsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [test, setTest] = useState<Test | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const data = await getTestDetails(Number(id));
        setTest(data);
      } catch (err) {
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
    showToast('Initializing active assessment session...', 'info');

    try {
      const attemptData = await startAttempt(test.id);
      showToast('Assessment session started! Good luck.', 'success');
      // Pass the details and questions list to the take page via React Router state
      navigate(`/tests/${test.id}/take`, { state: { attemptData, testTitle: test.title } });
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to start quiz attempt';
      showToast(msg, 'error');
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div className="spinner">Loading assessment settings...</div>
      </div>
    );
  }

  if (!test) return null;

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Back Link */}
      <div>
        <button 
          onClick={() => navigate('/tests')}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.875rem' }}
        >
          <ChevronLeft size={16} />
          <span>Back to Assessments</span>
        </button>
      </div>

      {/* Main card */}
      <div className="card" style={{ padding: '36px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary-500)', letterSpacing: '0.05em' }}>
          Instructions & Regulations
        </span>
        <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', marginBottom: '16px' }}>
          {test.title}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.5, margin: '0 0 32px 0' }}>
          {test.description}
        </p>

        {/* Specifications panel */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', padding: '20px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', marginBottom: '32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Questions Count</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <HelpCircle size={18} style={{ color: 'var(--primary-500)' }} />
              <span>{test.total_questions} Questions</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Duration Limit</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <Clock size={18} style={{ color: 'var(--primary-500)' }} />
              <span>{test.duration_minutes} Minutes</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Passing Threshold</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <CheckSquare size={18} style={{ color: 'var(--primary-500)' }} />
              <span>{test.passing_score_pct}% Score</span>
            </div>
          </div>
        </div>

        {/* Instructions Rules List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '36px' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Important Guidelines:
          </h4>
          <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <li>Ensure you have a stable network connection before starting.</li>
            <li>Once you click <strong>Start</strong>, the active countdown timer will begin and cannot be paused.</li>
            <li>You can flag questions using the <strong>Mark for Review</strong> toggle to skip and revisit them later.</li>
            <li>Do not close or refresh this tab during the quiz, as this will submit your answers automatically.</li>
            <li>Upon passing this assessment with a score of <strong>{test.passing_score_pct}% or higher</strong>, the next phase of your training will unlock.</li>
          </ul>
        </div>

        {/* Warning Callout Box */}
        <div 
          style={{ 
            display: 'flex', 
            gap: '12px', 
            padding: '16px 20px', 
            backgroundColor: 'var(--warning-50)', 
            border: '1px solid var(--warning-500)', 
            borderRadius: 'var(--radius-lg)', 
            color: 'var(--warning-600)',
            fontSize: '0.8125rem',
            lineHeight: 1.5,
            marginBottom: '36px'
          }}
        >
          <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Attempt limits:</strong> You have completed {test.attempts_count} of your {test.max_attempts} allowed attempts for this assessment. Make sure you have reviewed all Stage videos carefully.
          </div>
        </div>

        {/* Action button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
          <button
            onClick={() => navigate('/tests')}
            className="btn btn-outline"
            disabled={starting}
            style={{ padding: '12px 24px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            className="btn btn-primary"
            disabled={starting}
            style={{ padding: '12px 30px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            {starting ? 'Starting...' : 'Start Assessment'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default TestInstructionsPage;
