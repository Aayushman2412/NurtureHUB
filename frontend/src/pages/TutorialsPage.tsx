import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStages } from '../api/tutorials';
import { useToast } from '../context/ToastContext';
import { Play, CheckCircle, Clock, Lock } from 'lucide-react';
import { Badge, Card, Chip, EmptyState, PageLoader } from '../components/ui';
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

const filters = [
  { key: 'all', label: 'All Tutorials' },
  { key: 'completed', label: 'Completed' },
  { key: 'uncompleted', label: 'In Progress' },
] as const;

type FilterKey = (typeof filters)[number]['key'];

const TutorialsPage: React.FC = () => {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');

  const { showToast } = useToast();
  const navigate = useNavigate();

  const loadStages = async () => {
    try {
      const data = await getStages();
      setStages(data);
    } catch {
      showToast('Failed to load training stages', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStages();
  }, []);

  const handleTutorialClick = (stage: Stage, tut: Tutorial) => {
    if (stage.is_locked) {
      showToast('This training phase is currently locked. Complete previous assessments first.', 'warning');
      return;
    }
    navigate(`/tutorials/${tut.id}`);
  };

  if (loading) return <PageLoader label="Loading training modules…" />;

  const totalModules = stages.reduce((acc, s) => acc + s.tutorials.length, 0);
  const visibleStages = stages
    .map(stage => ({
      stage,
      filtered: stage.tutorials.filter(t => {
        if (filter === 'completed') return t.is_completed;
        if (filter === 'uncompleted') return !t.is_completed;
        return true;
      }),
    }))
    .filter(({ filtered }) => filter === 'all' || filtered.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          {filters.map(f => (
            <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
        <p className="text-[13px] text-ink-faint">{totalModules} modules in curriculum</p>
      </div>

      {visibleStages.length === 0 ? (
        <EmptyState
          icon={<Play />}
          title="Nothing here yet"
          description="No modules match this filter."
        />
      ) : (
        <div className="flex flex-col gap-10">
          {visibleStages.map(({ stage, filtered }) => (
            <div key={stage.id} className="flex flex-col gap-5">
              {/* Stage header */}
              <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-xl font-extrabold text-ink">{stage.title}</h3>
                    {stage.is_locked && (
                      <Badge variant="error">
                        <Lock className="size-2.5" /> Locked
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 max-w-3xl text-sm leading-snug text-ink-muted">{stage.description}</p>
                </div>
                {!stage.is_locked && (
                  <span className="whitespace-nowrap text-[13px] font-semibold text-primary">
                    {stage.tutorials_completed} / {stage.total_tutorials} Completed
                  </span>
                )}
              </div>

              {/* Tutorials grid */}
              {filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-strong/60 p-8 text-center text-sm text-ink-faint">
                  No modules match this filter.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map(tut => (
                    <Card
                      key={tut.id}
                      interactive={!stage.is_locked}
                      locked={stage.is_locked}
                      onClick={() => handleTutorialClick(stage, tut)}
                      className="flex flex-col overflow-hidden"
                    >
                      {/* Thumbnail */}
                      <div className="group relative flex h-40 items-center justify-center bg-gradient-to-br from-coral-500 to-sage-600 text-white">
                        <div className="flex size-13 items-center justify-center rounded-full bg-cream-950/40 shadow-md transition-transform group-hover:scale-110">
                          <Play className="ml-0.5 size-6 fill-white stroke-none" />
                        </div>
                        <span className="absolute left-3 top-3 rounded bg-cream-950/60 px-2 py-1 text-[11px] font-bold tracking-wide">
                          {tut.module_number}
                        </span>
                        {tut.is_completed && (
                          <span className="absolute right-3 top-3 flex items-center gap-1 rounded bg-success-500 px-2 py-1 text-[11px] font-bold">
                            <CheckCircle className="size-3" /> Completed
                          </span>
                        )}
                      </div>

                      {/* Body */}
                      <div className="flex flex-1 flex-col justify-between p-5">
                        <div>
                          <h4 className="mb-2 font-display text-base font-bold leading-tight text-ink">{tut.title}</h4>
                          <p className={cn('text-[13px] leading-snug text-ink-muted', 'line-clamp-2')}>
                            {tut.description}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-ink-faint">
                          <Clock className="size-3.5" />
                          <span>{tut.duration_minutes} Minutes duration</span>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TutorialsPage;
