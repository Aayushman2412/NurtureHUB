import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTests } from '../api/tests';
import { getResultsList } from '../api/results';
import { useToast } from '../context/ToastContext';
import { Award, Clock, HelpCircle, Lock, Play, ArrowRight, Eye } from 'lucide-react';

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

const TestsPage: React.FC = () => {
  const [tests, setTests] = useState<Test[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);

  const { showToast } = useToast();
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      const [testsData, attemptsData] = await Promise.all([
        getTests(),
        getResultsList()
      ]);
      setTests(testsData);
      setAttempts(attemptsData);
    } catch (err) {
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

  // Find associated test title for an attempt
  const getTestTitle = (testId: number) => {
    const match = tests.find(t => t.id === testId);
    return match ? match.title : 'Assessment';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div className="spinner">Loading assessment sheets...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
      
      {/* Quiz Cards Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h3 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Available Assessments
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          {tests.map((test) => (
            <div
              key={test.id}
              className={`card ${test.is_locked ? 'card-locked' : ''}`}
              style={{
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%',
                opacity: test.is_locked ? 0.75 : 1,
                border: test.is_passed ? '1px solid var(--success-500)' : '1px solid var(--border-color)',
                position: 'relative'
              }}
            >
              {/* Card headers */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary-500)', letterSpacing: '0.05em' }}>
                    Stage {test.stage_id} Assessment
                  </span>
                  {test.is_locked ? (
                    <span className="badge badge-error" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.6875rem' }}>
                      <Lock size={10} /> Locked
                    </span>
                  ) : test.is_passed ? (
                    <span className="badge badge-success">Passed ✓</span>
                  ) : (
                    <span className="badge badge-success">Unlocked</span>
                  )}
                </div>

                <h4 className="font-display" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px 0', lineHeight: 1.3 }}>
                  {test.title}
                </h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', lineHeight: 1.4, margin: '0 0 20px 0' }}>
                  {test.description}
                </p>

                {/* Info grids */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '24px', borderTop: '1px solid var(--border-color-light)', paddingTop: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <HelpCircle size={16} style={{ color: 'var(--text-muted)' }} />
                    <span>{test.total_questions} Questions</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock size={16} style={{ color: 'var(--text-muted)' }} />
                    <span>{test.duration_minutes} Minutes limit</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Award size={16} style={{ color: 'var(--text-muted)' }} />
                    <span>{test.passing_score_pct}% Pass mark</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Award size={16} style={{ color: 'var(--text-muted)' }} />
                    <span>Attempts: {test.attempts_count} / {test.max_attempts}</span>
                  </div>
                </div>
              </div>

              {/* Bottom statistics and Action */}
              <div 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  borderTop: '1px solid var(--border-color)', 
                  paddingTop: '16px',
                  marginTop: '12px'
                }}
              >
                <div>
                  {test.best_score !== null && (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      Best Score:{' '}
                      <strong style={{ color: test.is_passed ? 'var(--success-600)' : 'var(--error-600)' }}>
                        {test.best_score.toFixed(1)}%
                      </strong>
                    </span>
                  )}
                </div>

                {test.is_locked ? (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Lock size={12} /> Complete all stage videos
                  </span>
                ) : test.attempts_count >= test.max_attempts && !test.is_passed ? (
                  <span style={{ fontSize: '0.75rem', color: 'var(--error-600)', fontWeight: 600 }}>
                    Max attempts reached
                  </span>
                ) : (
                  <button
                    onClick={() => handleTestClick(test)}
                    className={`btn ${test.is_passed ? 'btn-outline' : 'btn-primary'}`}
                    style={{ padding: '6px 14px', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {test.is_passed ? (
                      <>
                        <span>Retake Quiz</span>
                        <ArrowRight size={14} />
                      </>
                    ) : (
                      <>
                        <Play size={12} style={{ fill: 'white', stroke: 'none' }} />
                        <span>Start Assessment</span>
                      </>
                    )}
                  </button>
                )}
              </div>

            </div>
          ))}
        </div>
      </div>

      {/* Attempts History List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h3 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Assessment History
        </h3>

        {attempts.length === 0 ? (
          <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No assessments attempted yet. Finish a course phase and take a quiz to see reports.
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '16px 20px', fontWeight: 600 }}>Assessment Title</th>
                    <th style={{ padding: '16px 20px', fontWeight: 600 }}>Attempt #</th>
                    <th style={{ padding: '16px 20px', fontWeight: 600 }}>Date Submited</th>
                    <th style={{ padding: '16px 20px', fontWeight: 600 }}>Duration Used</th>
                    <th style={{ padding: '16px 20px', fontWeight: 600 }}>Score</th>
                    <th style={{ padding: '16px 20px', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '16px 20px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((att) => (
                    <tr 
                      key={att.id} 
                      className="table-row-hover"
                      style={{ borderBottom: '1px solid var(--border-color-light)', cursor: 'pointer' }}
                      onClick={() => navigate(`/results/${att.id}`)}
                    >
                      <td style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {getTestTitle(att.test_id)}
                      </td>
                      <td style={{ padding: '16px 20px', color: 'var(--text-secondary)' }}>
                        Attempt #{att.attempt_number}
                      </td>
                      <td style={{ padding: '16px 20px', color: 'var(--text-secondary)' }}>
                        {new Date(att.submitted_at).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '16px 20px', color: 'var(--text-secondary)' }}>
                        {Math.floor(att.time_used_seconds / 60)}m {att.time_used_seconds % 60}s
                      </td>
                      <td style={{ padding: '16px 20px', fontWeight: 700, color: att.is_passed ? 'var(--success-600)' : 'var(--error-600)' }}>
                        {att.score.toFixed(1)}%
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        {att.is_passed ? (
                          <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>Pass</span>
                        ) : (
                          <span className="badge badge-error" style={{ fontSize: '0.75rem' }}>Fail</span>
                        )}
                      </td>
                      <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 10px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/results/${att.id}`);
                          }}
                        >
                          <Eye size={12} />
                          <span>Review</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default TestsPage;
