import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDetailedResult } from '../api/results';
import { useToast } from '../context/ToastContext';
import { CheckCircle, XCircle, Clock, Award, ChevronLeft, HelpCircle } from 'lucide-react';

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
      } catch (err) {
        showToast('Failed to load performance report details', 'error');
        navigate('/tests');
      } finally {
        setLoading(false);
      }
    };
    fetchResult();
  }, [attemptId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div className="spinner">Loading performance scorecard...</div>
      </div>
    );
  }

  if (!result) return null;

  const { attempt, test_title, passing_score_pct, correct_count, total_questions, answers } = result;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Back button */}
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

      {/* Summary Performance Card */}
      <div className="card" style={{ padding: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary-500)', letterSpacing: '0.05em' }}>
              Performance Report • Attempt #{attempt.attempt_number}
            </span>
            <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', marginBottom: '8px' }}>
              {test_title}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Submitted on {new Date(attempt.submitted_at).toLocaleDateString()} at{' '}
              {new Date(attempt.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '16px' }}>
            {/* Score block */}
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Score</span>
              <span className="font-display" style={{ fontSize: '2rem', fontWeight: 800, color: attempt.is_passed ? 'var(--success-600)' : 'var(--error-600)', lineHeight: 1 }}>
                {attempt.score.toFixed(0)}%
              </span>
            </div>
            
            {/* Pass/Fail badge */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span 
                className={`badge ${attempt.is_passed ? 'badge-success' : 'badge-error'}`}
                style={{ padding: '8px 16px', fontSize: '0.9375rem', fontWeight: 700 }}
              >
                {attempt.is_passed ? 'PASSED' : 'FAILED'}
              </span>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '20px', marginTop: '30px', padding: '16px 24px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Award size={20} style={{ color: 'var(--primary-500)' }} />
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Result Breakdown</span>
              <strong style={{ fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{correct_count} / {total_questions} Correct</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Clock size={20} style={{ color: 'var(--primary-500)' }} />
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Time Elapsed</span>
              <strong style={{ fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                {Math.floor(attempt.time_used_seconds / 60)}m {attempt.time_used_seconds % 60}s
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <HelpCircle size={20} style={{ color: 'var(--primary-500)' }} />
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Required Score</span>
              <strong style={{ fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{passing_score_pct}% Pass Mark</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Answer review question blocks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <h3 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Answer Key & Explanations Review
        </h3>

        {answers.map((ans, idx) => (
          <div 
            key={ans.question_id} 
            className="card" 
            style={{ 
              padding: '28px',
              borderLeft: `4px solid ${ans.selected_option_id === null ? 'var(--gray-300)' : ans.is_correct ? 'var(--success-500)' : 'var(--error-500)'}` 
            }}
          >
            {/* Header: Question Num + Correct status */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontWeight: 800, color: 'var(--primary-600)', fontSize: '1rem' }}>
                Question {idx + 1}
              </span>
              
              {ans.selected_option_id === null ? (
                <span className="badge badge-error" style={{ backgroundColor: 'var(--gray-200)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  Not Attempted
                </span>
              ) : ans.is_correct ? (
                <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle size={12} /> Correct
                </span>
              ) : (
                <span className="badge badge-error" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <XCircle size={12} /> Incorrect
                </span>
              )}
            </div>

            <h4 style={{ fontSize: '1.0625rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 20px 0', lineHeight: 1.4 }}>
              {ans.question_text}
            </h4>

            {/* Render options highlights */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {ans.options.map((opt) => {
                const isSelected = ans.selected_option_id === opt.id;
                const isCorrect = ans.correct_option_id === opt.id;

                let border = '1px solid var(--border-color)';
                let bg = 'var(--bg-secondary)';
                let color = 'var(--text-primary)';
                let indicator = '';

                if (isCorrect) {
                  border = '1px solid var(--success-500)';
                  bg = 'var(--success-50)';
                  color = 'var(--success-600)';
                  indicator = ' (Correct Option)';
                } else if (isSelected && !isCorrect) {
                  border = '1px solid var(--error-500)';
                  bg = 'var(--error-50)';
                  color = 'var(--error-600)';
                  indicator = ' (Your Answer)';
                }

                return (
                  <div
                    key={opt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      border,
                      backgroundColor: bg,
                      color,
                      fontSize: '0.875rem',
                      fontWeight: (isCorrect || isSelected) ? 600 : 500
                    }}
                  >
                    <div 
                      style={{ 
                        width: '24px', 
                        height: '24px', 
                        borderRadius: '50%', 
                        border: `2px solid ${isCorrect ? 'var(--success-500)' : isSelected ? 'var(--error-500)' : 'var(--gray-300)'}`,
                        backgroundColor: isCorrect ? 'var(--success-500)' : isSelected ? 'var(--error-500)' : 'transparent',
                        color: (isCorrect || isSelected) ? 'white' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        flexShrink: 0
                      }}
                    >
                      {opt.label}
                    </div>
                    <span>{opt.text}{indicator}</span>
                  </div>
                );
              })}
            </div>

          </div>
        ))}
      </div>

    </div>
  );
};

export default ResultsPage;
