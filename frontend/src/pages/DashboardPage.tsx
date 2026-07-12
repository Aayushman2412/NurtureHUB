import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getDashboardData } from '../api/dashboard';
import { BookOpen, Award, CheckCircle2, ChevronRight, Lock, Trophy, PlayCircle } from 'lucide-react';
import { Badge, Button, Card, PageLoader, ProgressBar, ProgressRing, StatCard, WelcomeBanner } from '../components/ui';

interface Achievement {
  id: number;
  title: string;
  description: string;
  emoji_icon: string;
  earned_at: string;
}

interface Activity {
  id: string;
  type: 'tutorial' | 'test';
  title: string;
  timestamp: string;
  status: string;
}

interface Tutorial {
  id: number;
  title: string;
  is_completed: boolean;
}

interface Stage {
  id: number;
  title: string;
  description: string;
  is_locked: boolean;
  tutorials_completed: number;
  total_tutorials: number;
  tutorials: Tutorial[];
}

interface DashboardData {
  progress_percentage: number;
  tutorials_completed: number;
  total_tutorials: number;
  tests_passed: number;
  total_tests: number;
  achievements: Achievement[];
  activities: Activity[];
  stages: Stage[];
}

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const loadDashboard = async () => {
    try {
      const res = await getDashboardData();
      setData(res);
    } catch {
      showToast('Failed to load dashboard metrics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (loading) return <PageLoader label="Loading metrics…" />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome Banner — shared component, styled once (adapts light/dark) */}
      <WelcomeBanner
        eyebrow={user?.program_district?.name ? `${user.program_district.name} District` : 'Welcome back, Supervisor'}
        title={
          <>
            {user?.full_name || 'Healthcare Worker'} <span className="align-middle">🌱</span>
          </>
        }
        subtitle={`You have completed ${data.tutorials_completed} of ${data.total_tutorials} video lessons. Keep up the good work!`}
      >
        <ProgressRing value={data.progress_percentage} size={92} />
        <span className="text-sm font-semibold leading-tight text-ink-muted">
          Overall
          <br />
          Progress
        </span>
      </WelcomeBanner>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<BookOpen />}
          tone="coral"
          label="Completed Tutorials"
          value={
            <>
              {data.tutorials_completed}{' '}
              <span className="text-base font-medium text-ink-faint">/ {data.total_tutorials}</span>
            </>
          }
        />
        <StatCard
          icon={<Award />}
          tone="amber"
          label="Assessments Passed"
          value={
            <>
              {data.tests_passed} <span className="text-base font-medium text-ink-faint">/ {data.total_tests}</span>
            </>
          }
        />
        <StatCard
          icon={<Trophy />}
          tone="sage"
          label="Achievements Earned"
          value={
            <>
              {data.achievements.length} <span className="text-base font-medium text-ink-faint">/ 3</span>
            </>
          }
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        {/* Stage timeline */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <h3 className="font-display text-xl font-bold text-ink">Training Progression Timeline</h3>

          <div className="flex flex-col gap-5">
            {data.stages.map((stg, i) => {
              const pct = stg.total_tutorials
                ? Math.round((stg.tutorials_completed / stg.total_tutorials) * 100)
                : 0;
              return (
                <Card key={stg.id} accent={stg.is_locked ? undefined : 'coral'} locked={stg.is_locked} className="p-6">
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-primary">Phase {i + 1}</span>
                      <h4 className="mt-0.5 mb-1.5 font-display text-lg font-bold text-ink">{stg.title}</h4>
                      <p className="text-sm leading-snug text-ink-muted">{stg.description}</p>
                    </div>
                    {stg.is_locked ? (
                      <Badge variant="error">
                        <Lock className="size-3" /> Locked
                      </Badge>
                    ) : (
                      <Badge variant="success">Unlocked</Badge>
                    )}
                  </div>

                  {!stg.is_locked && (
                    <div className="mt-5">
                      <div className="mb-1.5 flex justify-between text-xs font-semibold text-ink-muted">
                        <span>
                          Tutorial Completed: {stg.tutorials_completed} of {stg.total_tutorials}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <ProgressBar value={pct} tone="coral" />
                    </div>
                  )}

                  <div className="mt-4 flex justify-end border-t border-border pt-4">
                    {stg.is_locked ? (
                      <span className="text-[13px] text-ink-faint">
                        Complete previous assessments to unlock this phase.
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => navigate('/tutorials')}
                        iconLeft={<PlayCircle className="size-4" />}
                        iconRight={<ChevronRight className="size-3.5" />}
                      >
                        Resume Course
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Achievements */}
          <Card className="p-6">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <Trophy className="size-[18px] text-amber-500" />
              <span>Earned Badges</span>
            </h3>

            {data.achievements.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-faint">
                Complete courses &amp; assessments to unlock achievements.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.achievements.map(ach => (
                  <div key={ach.id} className="flex items-center gap-3 rounded-lg bg-surface-sunken p-2.5">
                    <span className="text-3xl">{ach.emoji_icon}</span>
                    <div>
                      <h4 className="text-sm font-bold text-ink">{ach.title}</h4>
                      <p className="text-xs text-ink-muted">{ach.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Activity feed */}
          <Card className="p-6">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <CheckCircle2 className="size-[18px] text-primary" />
              <span>Recent Activity</span>
            </h3>

            {data.activities.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-faint">No recent activity.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {data.activities.map((act, index) => (
                  <div key={act.id} className="flex gap-3 text-[13px]">
                    <div className="flex flex-col items-center">
                      <div
                        className={`mt-1 size-2.5 rounded-full ${
                          act.type === 'test' ? 'bg-amber-500' : 'bg-primary'
                        }`}
                      />
                      {index < data.activities.length - 1 && <div className="my-1 w-0.5 flex-1 bg-border" />}
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-ink">{act.title}</h4>
                      <div className="mt-0.5 flex justify-between text-ink-faint">
                        <span>Status: {act.status}</span>
                        <span>{new Date(act.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
