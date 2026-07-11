import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getStages, completeTutorial } from '../api/tutorials';
import { useToast } from '../context/ToastContext';
import { Play, CheckCircle, Clock, ChevronLeft, Check, Lock } from 'lucide-react';
import { Badge, Button, Card, PageLoader } from '../components/ui';
import { cn } from '../utils/cn';

interface Tutorial {
  id: number;
  stage_id: number;
  title: string;
  description: string;
  module_number: string;
  duration_minutes: number;
  video_url: string;
  gradient_colors: string;
  order_index: number;
  is_completed: boolean;
}

interface Stage {
  id: number;
  title: string;
  description: string;
  order_index: number;
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
  const [loading, setLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);

  const loadData = async () => {
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
      } else {
        showToast('Video module not found', 'error');
        navigate('/tutorials');
      }
    } catch {
      showToast('Failed to load player configurations', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleVideoEnded = async () => {
    if (!currentTutorial || currentTutorial.is_completed) return;
    try {
      await completeTutorial(currentTutorial.id);
      showToast(`Module completed: "${currentTutorial.title}"`, 'success');
      const updatedData = await getStages();
      setStages(updatedData);
      setCurrentTutorial(prev => (prev ? { ...prev, is_completed: true } : null));
    } catch (e) {
      console.error('Failed to save completion:', e);
    }
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
            <video
              ref={videoRef}
              src={currentTutorial.video_url}
              controls
              onEnded={handleVideoEnded}
              className="size-full object-contain"
              poster="https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80"
            />
          </div>

          <Card className="p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                {currentTutorial.module_number} • Video Lesson
              </span>
              {currentTutorial.is_completed && (
                <Badge variant="success">
                  <CheckCircle className="size-3" /> Completed
                </Badge>
              )}
            </div>

            <h2 className="mb-3 font-display text-2xl font-extrabold text-ink">{currentTutorial.title}</h2>
            <p className="text-[15px] leading-relaxed text-ink-muted">{currentTutorial.description}</p>

            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-[13px] text-ink-faint">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" /> {currentTutorial.duration_minutes} Mins Duration
              </span>
              <span className="hidden sm:inline">•</span>
              <span className="font-semibold text-primary">
                Tip: Watch this video to the end to mark it as completed and unlock assessments!
              </span>
            </div>
          </Card>
        </div>

        {/* Playlist */}
        <Card className="flex max-h-[72vh] flex-col p-5">
          <h3 className="mb-4 border-b border-border pb-3 font-display text-lg font-bold text-ink">Course Playlist</h3>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {stages.map(stg => (
              <div key={stg.id}>
                <h4 className="mb-2 flex justify-between text-[13px] font-bold uppercase tracking-wider text-ink-faint">
                  <span>{stg.title.split(':')[0]}</span>
                  {stg.is_locked && <Lock className="size-3" />}
                </h4>

                <div className="flex flex-col gap-1.5">
                  {stg.tutorials.map(tut => {
                    const isPlaying = tut.id === currentTutorial.id;
                    return (
                      <button
                        key={tut.id}
                        onClick={() => !stg.is_locked && navigate(`/tutorials/${tut.id}`)}
                        disabled={stg.is_locked}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                          isPlaying
                            ? 'border-primary/40 bg-coral-50 text-primary dark:bg-coral-500/10'
                            : 'border-transparent text-ink hover:bg-surface-sunken',
                          stg.is_locked && 'cursor-not-allowed opacity-50',
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
                            {tut.duration_minutes}m duration
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
    </div>
  );
};

export default TutorialPlayerPage;
