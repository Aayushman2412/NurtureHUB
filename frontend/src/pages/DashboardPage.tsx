import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getDashboardData } from '../api/dashboard';
import {
  CheckCircle2,
  ChevronRight,
  Lock,
  Trophy,
  PlayCircle,
  CalendarClock,
  FileText,
  Hourglass,
  KeyRound,
  MapPinOff,
  GraduationCap,
  HeartHandshake,
  Lightbulb,
  BarChart3,
  PartyPopper,
  Award,
} from 'lucide-react';
import { Badge, Button, Card, PageLoader, ProgressBar, ProgressRing, WelcomeBanner } from '../components/ui';
import SupportTeamCard from '../components/SupportTeamCard';
import TrainingRings from '../components/dashboard/TrainingRings';
import MyWorkCard from '../components/dashboard/MyWorkCard';
import MyProgressChart from '../components/dashboard/MyProgressChart';
import MyTeamCard from '../components/dashboard/MyTeamCard';
import { getMyWork, type MyWork } from '../api/myWork';
import { getTopicReport, type TestTopicReport } from '../api/results';
import TestTopicsCard from '../components/tests/TestTopicsCard';
import { cn } from '../utils/cn';

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
  duration_minutes?: number;
  watch_pct?: number;
  quiz_available?: boolean;
  quiz_status?: 'pending' | 'completed' | 'skipped';
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
  selected_for_f2f?: boolean;
  adoptions_open?: boolean;
  /** Where the learner is in the selection pipeline (review of 19 Oct 2026). */
  selection_state?: SelectionState;
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
      return <Badge variant="success"><span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current" aria-hidden />{t('test.status.live')}</Badge>;
    case 'scheduled':
      return <Badge variant="info">{t('test.status.scheduled')}</Badge>;
    case 'ended':
      return <Badge variant="error">{t('test.status.ended')}</Badge>;
    default:
      return <Badge variant="neutral">{t('test.status.notScheduled')}</Badge>;
  }
};

type SelectionState = 'in_progress' | 'awaiting' | 'not_selected' | 'selected';

const testPhaseMessage = (stg: Stage, state: SelectionState, t: TFunction): string => {
  const test = stg.test;
  if (!test) return '';
  if (test.is_submitted) {
    if (state === 'selected') return t('test.message.selected');
    if (state === 'not_selected') return t('test.message.announced');
    return t('test.message.submitted');
  }
  if (test.test_type === 'formative') return t('test.message.formative');
  if (test.test_type === 'screening') return t('test.message.screening');
  return t('test.message.default');
};

/** One line saying where the learner stands and what to do next — the
 *  "inference" for the four circles (review of 18 Oct 2026). */
const trainingStatus = (data: DashboardData, t: TFunction): string => {
  if (data.selection_state === 'selected') return t('status.selected');
  if (data.selection_state === 'not_selected') return t('status.notSelected');
  const tutorials = data.stages.flatMap(s => s.tutorials);
  const videosLeft = data.total_tutorials - data.tutorials_completed;
  const quizzesLeft = tutorials.filter(x => x.quiz_available && x.quiz_status === 'pending').length;
  const tests = data.stages.map(s => s.test).filter((x): x is StageTest => !!x);
  const live = tests.find(x => x.status === 'active' && !x.is_locked && !x.is_submitted);
  const next = tests.find(x => !x.is_submitted && x.status !== 'ended');
  if (live) return t('status.liveTest', { test: live.title });
  if (data.awaiting_results) return t('status.awaiting');
  if (videosLeft > 0) return t('status.videosLeft', { count: videosLeft });
  if (quizzesLeft > 0) return t('status.quizzesLeft', { count: quizzesLeft });
  if (next) return t('status.nextTest', { test: next.title, date: formatScheduled(next.scheduled_at, t) });
  return t('status.allDone');
};

type DashView = 'training' | 'adoptions';

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // The learner's own adoptions and forms (review of 17 Oct 2026); optional —
  // the dashboard renders without it.
  const [work, setWork] = useState<MyWork | null>(null);
  const [reports, setReports] = useState<TestTopicReport[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

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
    getMyWork().then(setWork).catch(() => { /* optional card */ });
    getTopicReport().then(setReports).catch(() => { /* optional card */ });
  }, []);

  if (loading) return <PageLoader label={t('loading')} />;
  if (!data) return null;

  // Two modes (review of 18 Oct 2026): until the screening test the project is
  // about training; "the moment adoption starts the project is in a very
  // different mode". Adoptions opens only once the learner is selected for
  // face-to-face training (19 Oct), and is then the first view.
  const adoptionsOpen = !!data.adoptions_open;
  const state: SelectionState = data.selection_state ?? (data.awaiting_results ? 'awaiting' : 'in_progress');
  const asked = searchParams.get('view');
  const view: DashView = adoptionsOpen && asked !== 'training' ? 'adoptions' : 'training';
  const setView = (v: DashView) => setSearchParams(v === (adoptionsOpen ? 'adoptions' : 'training') ? {} : { view: v }, { replace: true });

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
            {user?.full_name || t('welcome.nameFallback')}
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

      {/* An easy password is allowed, never forced — but asked about (review of 17 Oct 2026). */}
      {user?.password_weak && (
        <Card accent="amber" className="flex flex-wrap items-center gap-3 p-4">
          <KeyRound className="size-5 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-sm text-ink">{t('weakPassword.body')}</p>
          <Link to="/profile?tab=account" className="text-sm font-semibold text-primary-ink hover:text-primary-ink-hover">
            {t('weakPassword.action')}
          </Link>
        </Card>
      )}

      {/* Not in a project yet: say so, rather than "0 of 0 lessons". */}
      {!user?.program_district_id && (
        <Card className="flex items-start gap-3 p-4">
          <MapPinOff className="mt-0.5 size-5 shrink-0 text-ink-muted" />
          <div>
            <h4 className="font-display font-bold text-ink">{t('noProject.title')}</h4>
            <p className="text-sm text-ink-muted">{t('noProject.body')}</p>
          </div>
        </Card>
      )}

      {/* Training | Adoptions — the two modes of the project. */}
      {user?.program_district_id && (
        <div role="tablist" className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-surface p-1.5">
          {([
            { v: 'training' as const, icon: <GraduationCap className="size-5" />, label: t('modes.training'), hint: t('modes.trainingHint') },
            { v: 'adoptions' as const, icon: <HeartHandshake className="size-5" />, label: t('modes.adoptions'),
              hint: adoptionsOpen ? t('modes.adoptionsHint')
                : state === 'not_selected' ? t('modes.adoptionsNotSelected') : t('modes.adoptionsLocked') },
          ]).map(m => {
            const locked = m.v === 'adoptions' && !adoptionsOpen;
            const active = view === m.v;
            return (
              <button
                key={m.v}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={locked}
                onClick={() => setView(m.v)}
                className={cn(
                  'flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                  active ? 'bg-primary text-white shadow-sm' : 'text-ink hover:bg-surface-sunken',
                  locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                )}
              >
                <span className="shrink-0">{locked ? <Lock className="size-5" /> : m.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold sm:text-base">{m.label}</span>
                  <span className={cn('block truncate text-xs', active ? 'text-white/85' : 'text-ink-muted')}>{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {view === 'adoptions' ? (
        <>
          {/* My mothers and babies: adoptions, forms, what is due next. */}
          {work?.available ? <MyWorkCard work={work} /> : (
            <Card className="p-4 text-sm text-ink-muted sm:p-6">{t('modes.noWork')}</Card>
          )}
          {work?.available && work.cumulative && <MyProgressChart series={work.cumulative} />}
          {user?.is_batch_monitor && <MyTeamCard />}
        </>
      ) : (
      <>
      {/* Selected: the training is behind her, and her work is in Adoptions. */}
      {state === 'selected' && (
        <Card accent="sage" className="flex flex-wrap items-center gap-4 p-4 sm:p-6">
          <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-xl bg-sage-500/15 text-sage-600">
            <PartyPopper className="size-6" />
          </div>
          <div className="min-w-0 flex-1 basis-60">
            <h4 className="mb-1 font-display font-bold text-ink">{t('selection.selectedTitle')}</h4>
            <p className="text-sm leading-snug text-ink-muted">{t('selection.selectedBody')}</p>
          </div>
          <Button size="sm" onClick={() => setView('adoptions')} iconRight={<ChevronRight className="size-3.5" />}>
            {t('selection.openAdoptions')}
          </Button>
        </Card>
      )}

      {/* Finished, results announced, not on the list. */}
      {state === 'not_selected' && (
        <Card accent="amber" className="flex items-center gap-4 p-4 sm:p-6">
          <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <Award className="size-6" />
          </div>
          <div>
            <h4 className="mb-1 font-display font-bold text-ink">{t('selection.notSelectedTitle')}</h4>
            <p className="text-sm leading-snug text-ink-muted">{t('selection.notSelectedBody')}</p>
          </div>
        </Card>
      )}

      {/* Awaiting the selection for face-to-face training — everything is done */}
      {state === 'awaiting' && (
        <Card accent="amber" className="flex items-center gap-4 p-4 sm:p-6">
          <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <Hourglass className="size-6" />
          </div>
          <div>
            <h4 className="mb-1 font-display font-bold text-ink">{t('awaiting.title')}</h4>
            <p className="text-sm leading-snug text-ink-muted">{t('awaiting.body')}</p>
          </div>
        </Card>
      )}

      {/* Training at a glance: four circles, two by two on a phone, and what they mean. */}
      {data.total_tutorials + data.total_tests > 0 && (
        <div className="flex flex-col gap-3">
          <TrainingRings
            tutorials={data.stages.flatMap(s => s.tutorials)}
            testsPassed={data.tests_passed}
            totalTests={data.total_tests}
          />
          <p className="flex items-start gap-2 rounded-xl bg-surface-sunken/70 px-4 py-3 text-sm font-semibold text-ink">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>{trainingStatus(data, t)}</span>
          </p>
        </div>
      )}

      {/* The tests, topic by topic, with what to watch again. */}
      {reports.length > 0 && (
        <Card className="p-4 sm:p-6">
          <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-ink">
            <BarChart3 className="size-5 text-primary-ink" />{t('topics.title')}
          </h3>
          <p className="mb-4 text-sm text-ink-muted">{t('topics.subtitle')}</p>
          <div className="flex flex-col gap-6">
            {reports.map(r => <TestTopicsCard key={r.test_id} report={r} />)}
          </div>
        </Card>
      )}

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
                  <Card key={stg.id} accent={accent} className="p-4 sm:p-6">
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

                    {/* Scheduled date/time — only while it is still to come */}
                    {!test.is_submitted && (
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
                    )}

                    {/* Guidance + action */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
                      <span className="min-w-0 flex-1 basis-full sm:basis-52 text-[13px] text-ink-faint">{testPhaseMessage(stg, state, t)}</span>
                      {canTake ? (
                        <Button
                          size="sm"
                          onClick={() => navigate('/tutorials')}
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
                <Card key={stg.id} accent="coral" className="p-4 sm:p-6">
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-primary-ink">
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
          <Card className="p-4 sm:p-6">
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
          <Card className="p-4 sm:p-6">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <CheckCircle2 className="size-[18px] text-primary-ink" />
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
      </>
      )}

      <SupportTeamCard />
    </div>
  );
};

export default DashboardPage;
