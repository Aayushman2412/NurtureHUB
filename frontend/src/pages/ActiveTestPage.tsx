import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { submitAttempt } from '../api/tests';
import { useToast } from '../context/ToastContext';
import { AlertCircle, Clock, Eye, ChevronLeft, ChevronRight } from 'lucide-react';

interface Option {
  id: number;
  label: string;
  text: string;
}

interface Question {
  id: number;
  text: string;
  marks: number;
  order_index: number;
  options: Option[];
}

interface AttemptData {
  attempt_id: number;
  duration_minutes: number;
  questions: Question[];
}

interface AnswerState {
  [question_id: number]: {
    selected_option_id: number | null;
    is_marked_for_review: boolean;
  };
}

const ActiveTestPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const stateData = location.state as { attemptData: AttemptData; testTitle: string } | null;

  if (!stateData) {
    useEffect(() => {
      showToast('No active quiz session found.', 'warning');
      navigate('/tests');
    }, []);
    return null;
  }

  const { attemptData, testTitle } = stateData;
  const { attempt_id, duration_minutes, questions } = attemptData;

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [timeRemaining, setTimeRemaining] = useState(duration_minutes * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const timerRef = useRef<any>(null);

  // Keyboard Shortcuts navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentIdx > 0) {
        setCurrentIdx(prev => prev - 1);
      } else if (e.key === 'ArrowRight' && currentIdx < questions.length - 1) {
        setCurrentIdx(prev => prev + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIdx, questions.length]);

  // Countdown timer setup
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleAutoSubmit = async () => {
    showToast("Time's up! Submitting your answers automatically.", 'warning');
    await performSubmission();
  };

  const performSubmission = async () => {
    setIsSubmitting(true);
    
    // Format answers array
    const formattedAnswers = questions.map((q) => {
      const ans = answers[q.id];
      return {
        question_id: q.id,
        selected_option_id: ans ? ans.selected_option_id : null,
        is_marked_for_review: ans ? ans.is_marked_for_review : false,
      };
    });

    const timeUsed = duration_minutes * 60 - timeRemaining;

    try {
      const response = await submitAttempt(attempt_id, {
        answers: formattedAnswers,
        time_used_seconds: timeUsed
      });
      
      showToast('Assessment submitted successfully!', 'success');
      navigate(`/tests/${id}/submitted`, { state: { resultData: response, testTitle } });
    } catch (err: any) {
      showToast('Error submitting quiz answers. Please try again.', 'error');
      setIsSubmitting(false);
      setShowConfirm(false);
    }
  };

  const handleSelectOption = (questionId: number, optionId: number) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        selected_option_id: optionId,
        is_marked_for_review: prev[questionId]?.is_marked_for_review || false,
      },
    }));
  };

  const handleToggleReview = (questionId: number) => {
    setAnswers((prev) => {
      const current = prev[questionId];
      return {
        ...prev,
        [questionId]: {
          selected_option_id: current ? current.selected_option_id : null,
          is_marked_for_review: current ? !current.is_marked_for_review : true,
        },
      };
    });
  };

  const handleClearAnswer = (questionId: number) => {
    setAnswers((prev) => {
      const copy = { ...prev };
      if (copy[questionId]) {
        copy[questionId] = {
          selected_option_id: null,
          is_marked_for_review: copy[questionId].is_marked_for_review,
        };
      }
      return copy;
    });
  };

  const getTimerClass = () => {
    if (timeRemaining <= 60) return 'danger'; // 1 minute
    if (timeRemaining <= 300) return 'warning'; // 5 minutes
    return '';
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentQuestion = questions[currentIdx];
  const totalQuestions = questions.length;
  const answeredCount = Object.values(answers).filter((a) => a.selected_option_id !== null).length;
  const reviewCount = Object.values(answers).filter((a) => a.is_marked_for_review).length;
  const unansweredCount = totalQuestions - answeredCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '80vh', gap: '20px' }}>
      
      {/* Top Header bar with title, timer and submit */}
      <div 
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          backgroundColor: 'var(--bg-secondary)', 
          border: '1px solid var(--border-color)', 
          borderRadius: 'var(--radius-lg)', 
          padding: '16px 24px',
          flexWrap: 'wrap',
          gap: '16px'
        }}
      >
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--primary-500)', fontWeight: 700, textTransform: 'uppercase' }}>Active Assessment</span>
          <h3 className="font-display" style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            {testTitle}
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Timer block */}
          <div 
            id="testTimer" 
            className={`test-timer ${getTimerClass()}`}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '8px 16px', 
              borderRadius: 'var(--radius-md)', 
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              fontWeight: 700
            }}
          >
            <Clock size={16} />
            <span id="timerDisplay" style={{ fontFamily: 'monospace', fontSize: '1.125rem' }}>{formatTime(timeRemaining)}</span>
          </div>

          <button 
            className="btn btn-primary" 
            onClick={() => setShowConfirm(true)}
            style={{ padding: '8px 20px', fontWeight: 600 }}
          >
            Finish Test
          </button>
        </div>
      </div>

      {/* Main split work area */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '24px', flex: 1, minHeight: 0 }} className="active-test-grid">
        
        {/* Left pane: Active Question Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
          {/* Progress fill bar */}
          <div 
            style={{ 
              backgroundColor: 'var(--bg-secondary)', 
              padding: '12px 20px', 
              borderRadius: 'var(--radius-lg)', 
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              <span>Question {currentIdx + 1} of {totalQuestions}</span>
              <span>{Math.round(((currentIdx + 1) / totalQuestions) * 100)}% progress</span>
            </div>
            <div style={{ height: '6px', backgroundColor: 'var(--gray-100)', borderRadius: '3px', overflow: 'hidden' }}>
              <div 
                style={{ 
                  width: `${((currentIdx + 1) / totalQuestions) * 100}%`, 
                  height: '100%', 
                  backgroundColor: 'var(--primary-500)',
                  transition: 'width var(--transition-fast)' 
                }} 
              />
            </div>
          </div>

          {/* Question and choices */}
          <div className="card" style={{ padding: '32px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span className="question-number" style={{ fontWeight: 800, color: 'var(--primary-600)', fontSize: '1.125rem' }}>
                  Question {currentIdx + 1}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, backgroundColor: 'var(--bg-primary)', padding: '4px 8px', borderRadius: '4px' }}>
                  Marks: {currentQuestion.marks}
                </span>
              </div>

              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '24px', lineHeight: 1.4 }}>
                {currentQuestion.text}
              </h3>

              {/* Choices option list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {currentQuestion.options.map((opt) => {
                  const isSelected = answers[currentQuestion.id]?.selected_option_id === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleSelectOption(currentQuestion.id, opt.id)}
                      className={`option-item ${isSelected ? 'selected' : ''}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        padding: '16px 20px',
                        borderRadius: 'var(--radius-lg)',
                        border: `1px solid ${isSelected ? 'var(--primary-400)' : 'var(--border-color)'}`,
                        backgroundColor: isSelected ? 'var(--primary-50)' : 'var(--bg-secondary)',
                        color: isSelected ? 'var(--primary-900)' : 'var(--text-primary)',
                        width: '100%',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all var(--transition-fast)'
                      }}
                    >
                      <div 
                        style={{ 
                          width: '28px', 
                          height: '28px', 
                          borderRadius: '50%', 
                          border: `2px solid ${isSelected ? 'var(--primary-500)' : 'var(--gray-300)'}`,
                          backgroundColor: isSelected ? 'var(--primary-500)' : 'transparent',
                          color: isSelected ? 'white' : 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.875rem'
                        }}
                      >
                        {opt.label}
                      </div>
                      <span style={{ fontSize: '0.9375rem', fontWeight: 500 }}>{opt.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Actions for current question */}
            <div 
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginTop: '32px',
                borderTop: '1px solid var(--border-color-light)',
                paddingTop: '20px'
              }}
            >
              <div style={{ display: 'flex', gap: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={!!answers[currentQuestion.id]?.is_marked_for_review}
                    onChange={() => handleToggleReview(currentQuestion.id)}
                    style={{ accentColor: 'var(--accent-500)', width: '16px', height: '16px' }}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Eye size={16} /> Mark for Review
                  </span>
                </label>

                {answers[currentQuestion.id]?.selected_option_id !== null && (
                  <button
                    onClick={() => handleClearAnswer(currentQuestion.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--error-500)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Clear Selection
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="btn btn-outline"
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx(prev => prev - 1)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 16px', fontSize: '0.875rem' }}
                >
                  <ChevronLeft size={16} /> Back
                </button>
                <button
                  className="btn btn-outline"
                  disabled={currentIdx === questions.length - 1}
                  onClick={() => setCurrentIdx(prev => prev + 1)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 16px', fontSize: '0.875rem' }}
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Right pane: Question Map Grid Navigation */}
        <div 
          className="card" 
          style={{ 
            padding: '20px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '20px',
            minHeight: 0,
            overflowY: 'auto'
          }}
        >
          <h4 style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', color: 'var(--text-primary)' }}>
            Questions Map
          </h4>

          {/* Quick numbers tracker grid */}
          <div 
            style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(4, 1fr)', 
              gap: '10px' 
            }}
          >
            {questions.map((q, idx) => {
              const ansState = answers[q.id];
              const isCurrent = idx === currentIdx;
              const isAnswered = ansState?.selected_option_id !== null && ansState?.selected_option_id !== undefined;
              const isMarked = ansState?.is_marked_for_review;

              let btnBg = 'transparent';
              let btnBorder = '1px solid var(--border-color)';
              let btnColor = 'var(--text-secondary)';

              if (isCurrent) {
                btnBorder = '2px solid var(--primary-500)';
                btnBg = 'var(--primary-50)';
                btnColor = 'var(--primary-800)';
              } else if (isMarked) {
                btnBg = 'var(--accent-100)';
                btnBorder = '1px solid var(--accent-500)';
                btnColor = 'var(--accent-700)';
              } else if (isAnswered) {
                btnBg = 'var(--primary-500)';
                btnBorder = '1px solid var(--primary-600)';
                btnColor = 'white';
              }

              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentIdx(idx)}
                  className="q-num"
                  style={{
                    height: '38px',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    background: btnBg,
                    border: btnBorder,
                    color: btnColor,
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Color legend guides */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '16px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: 'var(--primary-500)' }} />
              <span>Answered</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: 'var(--accent-100)', border: '1px solid var(--accent-500)' }} />
              <span>Marked for Review</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '3px', border: '1px solid var(--border-color)' }} />
              <span>Unanswered</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '3px', border: '2px solid var(--primary-500)', backgroundColor: 'var(--primary-50)' }} />
              <span>Current Question</span>
            </div>
          </div>
        </div>

      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div 
          className="modal active" 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            backgroundColor: 'rgba(15,23,42,0.6)', 
            backdropFilter: 'blur(4px)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 'var(--z-modal)'
          }}
        >
          <div className="card" style={{ maxWidth: '440px', width: '100%', padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', gap: '12px', color: 'var(--primary-600)' }}>
              <AlertCircle size={24} style={{ flexShrink: 0 }} />
              <div>
                <h4 className="font-display" style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Submit Assessment?
                </h4>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px', margin: 0 }}>
                  Are you sure you want to finish and submit your answers?
                </p>
              </div>
            </div>

            {/* Statistics check summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', backgroundColor: 'var(--bg-primary)', padding: '16px', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>
              <div>Total Questions:</div>
              <div style={{ fontWeight: 700, textAlign: 'right' }}>{totalQuestions}</div>
              <div>Answered:</div>
              <div style={{ fontWeight: 700, textAlign: 'right', color: 'var(--primary-600)' }}>{answeredCount}</div>
              <div>Flagged for Review:</div>
              <div style={{ fontWeight: 700, textAlign: 'right', color: 'var(--accent-600)' }}>{reviewCount}</div>
              <div>Unanswered:</div>
              <div style={{ fontWeight: 700, textAlign: 'right', color: unansweredCount > 0 ? 'var(--error-500)' : 'var(--text-muted)' }}>{unansweredCount}</div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                className="btn btn-outline"
                onClick={() => setShowConfirm(false)}
                disabled={isSubmitting}
                style={{ padding: '10px 20px', cursor: 'pointer' }}
              >
                Go Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => performSubmission()}
                disabled={isSubmitting}
                style={{ padding: '10px 24px', fontWeight: 600, cursor: 'pointer' }}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Assessment'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ActiveTestPage;
