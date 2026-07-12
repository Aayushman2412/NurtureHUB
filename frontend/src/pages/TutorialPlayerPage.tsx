import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { completeTutorial, getStages, updateTutorialProgress } from '../api/tutorials';
import type { ProgressState } from '../api/tutorials';
import { useToast } from '../context/ToastContext';
import TrackedVideoPlayer from '../components/tutorials/TrackedVideoPlayer';
import type { PlayerBeat } from '../components/tutorials/TrackedVideoPlayer';
import TutorialQuizModal from '../components/tutorials/TutorialQuizModal';
import { Check, CheckCircle, ChevronLeft, Clock, HelpCircle, Lock, Play } from 'lucide-react';
import { Badge, Button, Card, PageLoader, ProgressBar } from '../components/ui';
import { cn } from '../utils/cn';

interface Tutorial {
  id: number;
  stage_id: number;
  title: string;
  description: string;
  module_number: string;
  duration_minutes: number;
  video_url: string | null;
  youtube_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  gradient_colors: string;
  order_index: number;
  is_completed: boolean;
  watch_pct: number;
  watch_time_seconds: number;
  quiz_available: boolean;
  quiz_status: 'pending' | 'completed' | 'skipped';
}

interface Stage {
  id: number;
  title: string;
  description: string;
  order_index: number;
  stage_type: string;
  is_locked: boolean;
  tutorials_completed: number;
  total_tutorials: number;
  tutorials: Tutorial[];
}

const TutorialPlayerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [stages, setStages] = useState<Stage[]>([]);
  const [currentTutorial, setCurrentTutorial] = useState<Tutorial | null>(null);
  const [watchPct, setWatchPct] = useState(0);
  const [quizOpen, setQuizOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // The quiz popup should appear at most once per page view.
  const quizShownRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const data = await getStages();
      setStages(data);

      const targetId = Number(id);
      let found: Tutorial | null = null;
      for (const stg of data) {
        const match = stg.tutorials.find((t: Tutorial) => t.id === targetId);
        if (match) {
          found = match;
          break;
        }
      }

      if (found) {
        setCurrentTutorial(found);
        setWatchPct(found.watch_pct || 0);
      } else {
        showToast('Video module not found', 'error');
        navigate('/tutorials');
      }
    } catch {
      showToast('Failed to load player configurations', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    quizShownRef.current = false;
    loadData();
  }, [id, loadData]);

  const maybeOpenQuiz = (state: Pick<ProgressState, 'quiz_available' | 'quiz_status'>) => {
    if (state.quiz_available && state.quiz_status === 'pending' && !quizShownRef.current) {
      quizShownRef.current = true;
      setQuizOpen(true);
    }
  };

  // Watch-tracking heartbeat from the player (every ~10s of real playback).
  const handleBeat = async (beat: PlayerBeat) => {
    if (!currentTutorial) return;
    try {
      const state = await updateTutorialProgress(currentTutorial.id, {
        position_seconds: beat.position_seconds,
        watched_delta_seconds: beat.watched_delta_seconds,
        duration_seconds: beat.duration_seconds,
      });
      setWatchPct(state.watch_pct);
      if (state.is_completed && !currentTutorial.is_completed) {
        setCurrentTutorial((prev) => (prev ? { ...prev, is_completed: true } : null));
        showToast(`Module completed: "${currentTutorial.title}"`, 'success');
        getStages().then(setStages).catch(() => {});
        maybeOpenQuiz(state);
      }
    } catch (e) {
      // Non-fatal: tracking beats may fail transiently (offline etc.)
      console.error('Failed to report watch progress:', e);
    }
  };

  const handleVideoEnded = async () => {
    if (!currentTutorial) return;
    try {
      const res = await completeTutorial(currentTutorial.id);
      if (!currentTutorial.is_completed) {
        showToast(`Module completed: "${currentTutorial.title}"`, 'success');
      }
      setCurrentTutorial((prev) => (prev ? { ...prev, is_completed: true } : null));
      getStages().then(setStages).catch(() => {});
      maybeOpenQuiz({ quiz_available: res.quiz_available, quiz_status: res.quiz_status });
    } catch (e) {
      console.error('Failed to save completion:', e);
    }
  };

  const handleQuizClose = (outcome: 'completed' | 'skipped' | 'dismissed') => {
    setQuizOpen(false);
    if (outcome === 'completed') showToast('Quiz responses recorded. Great job!', 'success');
    if (outcome === 'skipped') showToast('Quiz skipped — you can revisit the video anytime.', 'info');
    getStages().then(setStages).catch(() => {});
  };

  if (loading) return <PageLoader label="Loading player panel…" />;
  if (!currentTutorial) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/tutorials')}
          iconLeft={<ChevronLeft className="size-4" />}
        >
          Back to Modules
        </Button>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[3fr_1.2fr]">
        {/* Player + info */}
        <div className="flex flex-col gap-5">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-black shadow-lg">
            <TrackedVideoPlayer
              key={currentTutorial.id}
              videoUrl={currentTutorial.video_url}
              youtubeUrl={currentTutorial.youtube_url}
              startSeconds={currentTutorial.start_seconds}
              endSeconds={currentTutorial.end_seconds}
              onBeat={handleBeat}
              onEnded={handleVideoEnded}
            />
          </div>

          {/* Watch progress */}
          <Card className="px-5 py-4">
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-ink-muted">
              <span>Watched</span>
              <span>{Math.round(watchPct)}%</span>
            </div>
            <ProgressBar value={watchPct} tone={watchPct >= 90 ? 'sage' : 'coral'} />
          </Card>

          <Card className="p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                {currentTutorial.module_number} • Video Lesson
              </span>
              <div className="flex items-center gap-2">
                {currentTutorial.quiz_available && (
                  <Badge variant="coral">
                    <HelpCircle className="size-3" /> Quiz after video
                  </Badge>
                )}
                {currentTutorial.is_completed && (
                  <Badge variant="success">
                    <CheckCircle className="size-3" /> Completed
                  </Badge>
                )}
              </div>
            </div>

            <h2 className="mb-3 font-display text-2xl font-extrabold text-ink">{currentTutorial.title}</h2>
            <p className="text-[15px] leading-relaxed text-ink-muted">{currentTutorial.description}</p>

            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-[13px] text-ink-faint">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" /> {currentTutorial.duration_minutes} Mins Duration
              </span>
              <span className="hidden sm:inline">•</span>
              <span className="font-semibold text-primary">
                Your watch time is tracked — watch the full video to mark it complete and stay eligible for tests!
              </span>
            </div>
          </Card>
        </div>

        {/* Playlist */}
        <Card className="flex max-h-[72vh] flex-col p-5">
          <h3 className="mb-4 border-b border-border pb-3 font-display text-lg font-bold text-ink">Course Playlist</h3>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {stages
              .filter((stg) => stg.tutorials.length > 0)
              .map((stg) => (
                <div key={stg.id}>
                  <h4 className="mb-2 flex justify-between text-[13px] font-bold uppercase tracking-wider text-ink-faint">
                    <span>{stg.title.split(':')[0]}</span>
                    {stg.is_locked && <Lock className="size-3" />}
                  </h4>

                  <div className="flex flex-col gap-1.5">
                    {stg.tutorials.map((tut) => {
                      const isPlaying = tut.id === currentTutorial.id;
                      return (
                        <button
                          key={tut.id}
                          onClick={() => navigate(`/tutorials/${tut.id}`)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                            isPlaying
                              ? 'border-primary/40 bg-coral-50 text-primary dark:bg-coral-500/10'
                              : 'border-transparent text-ink hover:bg-surface-sunken',
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-white',
                              tut.is_completed ? 'border-success-500 bg-success-500' : 'border-border-strong',
                            )}
                          >
                            {tut.is_completed ? (
                              <Check className="size-3" strokeWidth={3} />
                            ) : (
                              <Play
                                className={cn(
                                  'ml-px size-2 stroke-none',
                                  isPlaying ? 'fill-primary' : 'fill-ink-faint',
                                )}
                              />
                            )}
                          </span>

                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{tut.title}</span>
                            <span className={cn('text-[11px]', isPlaying ? 'text-primary' : 'text-ink-faint')}>
                              {tut.duration_minutes}m • {Math.round(tut.watch_pct || 0)}% watched
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      </div>

      {/* Post-tutorial quiz popup */}
      {quizOpen && currentTutorial && (
        <TutorialQuizModal
          tutorialId={currentTutorial.id}
          tutorialTitle={currentTutorial.title}
          onClose={handleQuizClose}
        />
      )}
    </div>
  );
};

export default TutorialPlayerPage;
