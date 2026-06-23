import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { CheckCircle2, Award, ArrowRight, BarChart2 } from 'lucide-react';

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

  const stateData = location.state as { resultData: ResultData; testTitle: string } | null;

  if (!stateData) {
    useEffect(() => {
      showToast('No submitted assessment details found.', 'warning');
      navigate('/tests');
    }, []);
    return null;
  }

  const { resultData, testTitle } = stateData;
  const { attempt_id, score, is_passed, correct_answers_count, total_questions } = resultData;

  // Trigger prototype confetti on mount
  useEffect(() => {
    const colors = ['#0FADA0', '#F59E0B', '#3182CE', '#38A169', '#E53E3E', '#764ba2', '#f5576c'];
    const elements: HTMLDivElement[] = [];

    for (let i = 0; i < 65; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti-piece';
      confetti.style.left = Math.random() * 100 + 'vw';
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.animationDuration = (Math.random() * 2 + 2.2) + 's';
      confetti.style.animationDelay = Math.random() * 1.5 + 's';
      confetti.style.width = (Math.random() * 8 + 6) + 'px';
      confetti.style.height = (Math.random() * 8 + 6) + 'px';
      confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      
      document.body.appendChild(confetti);
      elements.push(confetti);
    }

    // Cleanup elements on unmount
    return () => {
      elements.forEach(el => el.remove());
    };
  }, []);

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '30px' }}>
      
      {/* Visual Splash Box */}
      <div className="card" style={{ padding: '48px 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
        
        {/* Animated Check circle */}
        <div 
          style={{ 
            width: '80px', 
            height: '80px', 
            borderRadius: '50%', 
            backgroundColor: is_passed ? 'var(--success-50)' : 'var(--error-50)', 
            color: is_passed ? 'var(--success-500)' : 'var(--error-500)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-md)'
          }}
        >
          {is_passed ? <CheckCircle2 size={44} /> : <Award size={44} />}
        </div>

        <div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary-500)', letterSpacing: '0.05em' }}>
            Assessment Completed
          </span>
          <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', marginBottom: '8px' }}>
            {is_passed ? 'Congratulations! You Passed' : 'Assessment Completed'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', margin: 0 }}>
            Your answers for <strong>{testTitle}</strong> have been submitted successfully.
          </p>
        </div>

        {/* Results Metrics breakdown */}
        <div 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-around', 
            width: '100%', 
            padding: '24px 0', 
            borderTop: '1px solid var(--border-color)', 
            borderBottom: '1px solid var(--border-color)',
            margin: '12px 0'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Score Achieved</span>
            <span className="font-display" style={{ fontSize: '1.5rem', fontWeight: 800, color: is_passed ? 'var(--success-600)' : 'var(--error-600)' }}>
              {score.toFixed(1)}%
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Correct Answers</span>
            <span className="font-display" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {correct_answers_count} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>/ {total_questions}</span>
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Outcome</span>
            <span 
              className={`badge ${is_passed ? 'badge-success' : 'badge-error'}`}
              style={{ padding: '6px 12px', fontSize: '0.8125rem', fontWeight: 700, margin: '0 auto' }}
            >
              {is_passed ? 'PASSED' : 'FAILED'}
            </span>
          </div>
        </div>

        {/* Informative text */}
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
          {is_passed 
            ? 'Great job! The next training stage and assessment have been unlocked on your dashboard.'
            : 'You did not meet the passing score of 70%. Review the video tutorials and try again. You have remaining attempts.'
          }
        </p>

        {/* Action button rows */}
        <div style={{ display: 'flex', gap: '16px', width: '100%', marginTop: '12px' }}>
          <button
            className="btn btn-outline"
            onClick={() => navigate('/tests')}
            style={{ flex: 1, padding: '12px', fontSize: '0.9375rem', cursor: 'pointer' }}
          >
            Assessments List
          </button>
          
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/results/${attempt_id}`)}
            style={{ flex: 1.5, padding: '12px', fontWeight: 600, fontSize: '0.9375rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <BarChart2 size={16} />
            <span>View Performance Report</span>
            <ArrowRight size={14} />
          </button>
        </div>

      </div>
    </div>
  );
};

export default TestSubmittedPage;
