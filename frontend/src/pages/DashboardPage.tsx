import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getDashboardData } from '../api/dashboard';
import {
  BookOpen,
  Award,
  CheckCircle2,
  ChevronRight,
  Lock,
  Trophy,
  PlayCircle,
  CalendarClock,
  FileText,
  Hourglass,
} from 'lucide-react';
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

interface StageTest {
  id: number;
  title: string;
  status: 'draft' | 'scheduled' | 'active' | 'ended';
  test_type: 'formative' | 'screening' | null;
  scheduled_at: string | null;
  duration_minutes: number;
  attempts_count: number;
  is_passed: boolean;
  is_submitted: boolean;
  is_locked: boolean;
  needs_videos: boolean;
}

interface Stage {
  id: number;
  title: string;
  description: string;
  stage_type: 'tutorials' | 'test';
  is_locked: boolean;
  tutorials_completed: number;
  total_tutorials: number;
  tutorials: Tutorial[];
  test: StageTest | null;
}

interface DashboardData {
  progress_percentage: number;
  tutorials_completed: number;
  total_tutorials: number;
  tests_passed: number;
  total_tests: number;
  awaiting_results: boolean;
  achievements: Achievement[];
  activities: Activity[];
  stages: Stage[];
}

const formatScheduled = (iso: string | null, t: TFunction): string => {
  if (!iso) return t('test.toBeAnnounced');
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const testStatusBadge = (status: StageTest['status'], t: TFunction) => {
  switch (status) {
    case 'active':
      return <Badge variant="success">● {t('test.status.live')}</Badge>;
    case 'scheduled':
      return <Badge variant="info">{t('test.status.scheduled')}</Badge>;
    case 'ended':
      return <Badge variant="error">{t('test.status.ended')}</Badge>;
    default:
      return <Badge variant="neutral">{t('test.status.notScheduled')}</Badge>;
  }
};

const testPhaseMessage = (stg: Stage, t: TFunction): string => {
  const test = stg.test;
  if (!test) return '';
  if (test.is_submitted) return t('test.message.submitted');
  if (test.test_type === 'formative') return t('test.message.formative');
  if (test.test_type === 'screening') return t('test.message.screening');
  return t('test.message.default');
};

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const loadDashboard = async () => {
    try {
      const res = await getDashboardData();
      setData(res);
    } catch {
      showToast(t('toast.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (loading) return <PageLoader label={t('loading')} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome Banner — shared component, styled once (adapts light/dark) */}
      <WelcomeBanner
        eyebrow={
          user?.program_district?.name
            ? t('welcome.districtEyebrow', { district: user.program_district.name })
            : t('welcome.defaultEyebrow')
        }
        title={
          <>
            {user?.full_name || t('welcome.nameFallback')} <span className="align-middle">🌱</span>
          </>
        }
        subtitle={t('welcome.subtitle', {
          completed: data.tutorials_completed,
          total: data.total_tutorials,
        })}
      >
        <ProgressRing value={data.progress_percentage} size={92} />
        <span className="text-sm font-semibold leading-tight text-ink-muted">
          {t('welcome.overall')}
          <br />
          {t('welcome.progress')}
        </span>
      </WelcomeBanner>

      {/* Awaiting results banner — everything is done */}
      {data.awaiting_results && (
        <Card accent="amber" className="flex items-center gap-4 p-6">
          <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <Hourglass className="size-6" />
          </div>
          <div>
            <h4 className="mb-1 font-display font-bold text-ink">{t('awaiting.title')}</h4>
            <p className="text-sm leading-snug text-ink-muted">{t('awaiting.body')}</p>
          </div>
        </Card>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<BookOpen />}
          tone="coral"
          label={t('stats.tutorials')}
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
          label={t('stats.assessments')}
          value={
            <>
              {data.tests_passed} <span className="text-base font-medium text-ink-faint">/ {data.total_tests}</span>
            </>
          }
        />
        <StatCard
          icon={<Trophy />}
          tone="sage"
          label={t('stats.achievements')}
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
          <h3 className="font-display text-xl font-bold text-ink">{t('timeline')}</h3>

          <div className="flex flex-col gap-5">
            {data.stages.map((stg, i) => {
              const isTestPhase = stg.stage_type === 'test' || (!!stg.test && stg.tutorials.length === 0);

              // ── Test phase card (formative / screening) ──
              if (isTestPhase && stg.test) {
                const test = stg.test;
                const canTake = test.status === 'active' && !stg.is_locked && !test.is_submitted;
                const accent = test.is_submitted || canTake ? 'sage' : 'amber';
                return (
                  <Card key={stg.id} accent={accent} className="p-6">
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <div>
                        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600">
                          <FileText className="size-3" /> {t('phase', { n: i + 1 })} •{' '}
                          {test.test_type === 'screening' ? t('test.screeningLabel') : t('test.formativeLabel')}
                        </span>
                        <h4 className="mt-0.5 mb-1.5 font-display text-lg font-bold text-ink">{test.title}</h4>
                        <p className="text-sm leading-snug text-ink-muted">{stg.description}</p>
                      </div>
                      {test.is_submitted ? (
                        <Badge variant="success">
                          <CheckCircle2 className="size-3" /> {t('test.submitted')}
                        </Badge>
                      ) : (
                        testStatusBadge(test.status, t)
                      )}
                    </div>

                    {/* Scheduled date/time */}
                    <div className="mt-3.5 flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-surface-sunken px-4 py-3">
                      <CalendarClock className="size-[18px] flex-shrink-0 text-amber-600" />
                      <div className="text-[13px]">
                        <span className="block text-ink-faint">
                          {test.status === 'active' ? t('test.liveHeading') : t('test.tentativeHeading')}
                        </span>
                        <strong className="text-ink">
                          {test.status === 'active' ? t('test.takeNow') : formatScheduled(test.scheduled_at, t)}
                        </strong>
                        <span className="text-ink-faint"> • {t('test.durationMins', { minutes: test.duration_minutes })}</span>
                      </div>
                    </div>

                    {/* Guidance + action */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
                      <span className="min-w-[220px] flex-1 text-[13px] text-ink-faint">{testPhaseMessage(stg, t)}</span>
                      {canTake ? (
                        <Button
                          size="sm"
                          onClick={() => navigate('/tests')}
                          iconRight={<ChevronRight className="size-3.5" />}
                        >
                          {t('test.takeTest')}
                        </Button>
                      ) : test.is_locked && !test.is_submitted ? (
                        <Badge variant="neutral">
                          <Lock className="size-3" />{' '}
                          {test.needs_videos ? t('test.finishVideos') : t('test.waitingAdmin')}
                        </Badge>
                      ) : null}
                    </div>
                  </Card>
                );
              }

              // ── Tutorial phase card (basic / add-on videos) ──
              const pct = stg.total_tutorials
                ? Math.round((stg.tutorials_completed / stg.total_tutorials) * 100)
                : 0;
              const completed = stg.total_tutorials > 0 && stg.tutorials_completed >= stg.total_tutorials;
              return (
                <Card key={stg.id} accent="coral" className="p-6">
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-primary">
                        {t('phase', { n: i + 1 })} • {t('videos.label')}
                      </span>
                      <h4 className="mt-0.5 mb-1.5 font-display text-lg font-bold text-ink">{stg.title}</h4>
                      <p className="text-sm leading-snug text-ink-muted">{stg.description}</p>
                    </div>
                    {completed ? (
                      <Badge variant="success">
                        <CheckCircle2 className="size-3" /> {t('videos.completed')}
                      </Badge>
                    ) : (
                      <Badge variant="coral">{t('videos.inProgress')}</Badge>
                    )}
                  </div>

                  {stg.total_tutorials > 0 && (
                    <div className="mt-5">
                      <div className="mb-1.5 flex justify-between text-xs font-semibold text-ink-muted">
                        <span>
                          {t('videos.tutorialsCompleted', {
                            completed: stg.tutorials_completed,
                            total: stg.total_tutorials,
                          })}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <ProgressBar value={pct} tone="coral" />
                    </div>
                  )}

                  <div className="mt-4 flex justify-end border-t border-border pt-4">
                    <Button
                      size="sm"
                      onClick={() => navigate('/tutorials')}
                      iconLeft={<PlayCircle className="size-4" />}
                      iconRight={<ChevronRight className="size-3.5" />}
                    >
                      {stg.tutorials_completed > 0 ? t('videos.resume') : t('videos.start')}
                    </Button>
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
              <span>{t('badges.title')}</span>
            </h3>

            {data.achievements.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-faint">{t('badges.empty')}</p>
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
              <span>{t('activity.title')}</span>
            </h3>

            {data.activities.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-faint">{t('activity.empty')}</p>
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
                        <span>{t('activity.status', { status: act.status })}</span>
                        <span>{new Date(act.timestamp).toLocaleDateString('en-GB')}</span>
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
