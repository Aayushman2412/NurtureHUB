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
  started_at?: string;
  questions: Question[];
}

interface AnswerState {
  [question_id: number]: {
    selected_option_id: number | null;
    is_marked_for_review: boolean;
  };
}

/** Calculate remaining seconds from a start timestamp and total duration. */
const calcRemaining = (startIso: string, durationMinutes: number): number => {
  const startMs = new Date(startIso).getTime();
  const nowMs = Date.now();
  const elapsed = Math.floor((nowMs - startMs) / 1000);
  return Math.max(0, durationMinutes * 60 - elapsed);
};

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

  // --- Persist start time to localStorage so timer survives refresh ---
  const storageKey = `nurturehub_attempt_${attempt_id}`;

  const getPersistedStartTime = (): string => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.startedAt) return parsed.startedAt;
      } catch { /* ignore */ }
    }
    // Use server-provided started_at, or fallback to now
    const startedAt = attemptData.started_at || new Date().toISOString();
    // Persist for future refreshes
    const existing = stored ? JSON.parse(stored) : {};
    localStorage.setItem(storageKey, JSON.stringify({ ...existing, startedAt }));
    return startedAt;
  };

  const startedAt = getPersistedStartTime();
  const initialRemaining = calcRemaining(startedAt, duration_minutes);

  // --- Restore persisted answers ---
  const getPersistedAnswers = (): AnswerState => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.answers) return parsed.answers;
      }
    } catch { /* ignore */ }
    return {};
  };

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>(getPersistedAnswers);
  const [timeRemaining, setTimeRemaining] = useState(initialRemaining);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const timerRef = useRef<any>(null);

  // Persist answers to localStorage whenever they change
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const existing = stored ? JSON.parse(stored) : {};
      localStorage.setItem(storageKey, JSON.stringify({ ...existing, answers }));
    } catch { /* ignore */ }
  }, [answers]);

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

  // Countdown timer — recalculates from start time each tick for accuracy
  useEffect(() => {
    if (initialRemaining <= 0) {
      handleAutoSubmit();
      return;
    }

    timerRef.current = setInterval(() => {
      const remaining = calcRemaining(startedAt, duration_minutes);
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        handleAutoSubmit();
      }
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
    <div className="active-test-wrapper">
      
      {/* Top Header bar with title, timer and submit */}
      <div className="active-test-header">
        <div>
          <span className="active-test-badge">Active Assessment</span>
          <h3 className="font-display active-test-title">
            {testTitle}
          </h3>
        </div>

        <div className="active-test-header-actions">
          {/* Timer block */}
          <div 
            id="testTimer" 
            className={`test-timer ${getTimerClass()}`}
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

      {/* Question counter (replaces progress bar) */}
      <div className="active-test-counter">
        <span>Question {currentIdx + 1} of {totalQuestions}</span>
      </div>

      {/* Main split work area */}
      <div className="active-test-grid">
        
        {/* Left pane: Active Question Card */}
        <div className="active-test-question-pane">

          {/* Question and choices */}
          <div className="card active-test-question-card">
            <div>
              <div className="active-test-question-header">
                <span className="active-test-question-number">
                  Question {currentIdx + 1}
                </span>
                <span className="active-test-marks-badge">
                  Marks: {currentQuestion.marks}
                </span>
              </div>

              <h3 className="active-test-question-text">
                {currentQuestion.text}
              </h3>

              {/* Choices option list */}
              <div className="active-test-options">
                {currentQuestion.options.map((opt) => {
                  const isSelected = answers[currentQuestion.id]?.selected_option_id === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleSelectOption(currentQuestion.id, opt.id)}
                      className={`active-test-option ${isSelected ? 'selected' : ''}`}
                    >
                      <div className={`active-test-option-label ${isSelected ? 'selected' : ''}`}>
                        {opt.label}
                      </div>
                      <span className="active-test-option-text">{opt.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Actions for current question */}
            <div className="active-test-actions">
              <div className="active-test-actions-left">
                <label className="active-test-review-label">
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
                    className="active-test-clear-btn"
                  >
                    Clear Selection
                  </button>
                )}
              </div>

              <div className="active-test-nav-btns">
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
        <div className="card active-test-map-panel">
          <h4 className="active-test-map-title">
            Questions Map
          </h4>

          {/* Quick numbers tracker grid */}
          <div className="active-test-map-grid">
            {questions.map((q, idx) => {
              const ansState = answers[q.id];
              const isCurrent = idx === currentIdx;
              const isAnswered = ansState?.selected_option_id !== null && ansState?.selected_option_id !== undefined;
              const isMarked = ansState?.is_marked_for_review;

              let statusClass = '';
              if (isCurrent) statusClass = 'current';
              else if (isMarked) statusClass = 'marked';
              else if (isAnswered) statusClass = 'answered';

              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentIdx(idx)}
                  className={`active-test-map-btn ${statusClass}`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Color legend guides */}
          <div className="active-test-legend">
            <div className="active-test-legend-item">
              <div className="active-test-legend-dot answered" />
              <span>Answered</span>
            </div>
            <div className="active-test-legend-item">
              <div className="active-test-legend-dot marked" />
              <span>Marked for Review</span>
            </div>
            <div className="active-test-legend-item">
              <div className="active-test-legend-dot unanswered" />
              <span>Unanswered</span>
            </div>
            <div className="active-test-legend-item">
              <div className="active-test-legend-dot current-q" />
              <span>Current Question</span>
            </div>
          </div>
        </div>

      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div 
          className="modal-backdrop active" 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            backgroundColor: 'rgba(15,23,42,0.6)', 
            backdropFilter: 'blur(4px)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 'var(--z-modal-backdrop)',
            padding: '16px'
          }}
        >
          <div className="modal active-test-confirm-modal">
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
            <div className="active-test-confirm-stats">
              <div>Total Questions:</div>
              <div style={{ fontWeight: 700, textAlign: 'right' }}>{totalQuestions}</div>
              <div>Answered:</div>
              <div style={{ fontWeight: 700, textAlign: 'right', color: 'var(--primary-600)' }}>{answeredCount}</div>
              <div>Flagged for Review:</div>
              <div style={{ fontWeight: 700, textAlign: 'right', color: 'var(--accent-600)' }}>{reviewCount}</div>
              <div>Unanswered:</div>
              <div style={{ fontWeight: 700, textAlign: 'right', color: unansweredCount > 0 ? 'var(--error-500)' : 'var(--text-muted)' }}>{unansweredCount}</div>
            </div>

            <div className="active-test-confirm-actions">
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
