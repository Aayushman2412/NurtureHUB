import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as XLSX from 'xlsx';
import { Download, RefreshCw, MonitorPlay, SkipForward, CheckCircle2, Search } from 'lucide-react';
import client from '../../api/client';
import {
  Button,
  EmptyState,
  Input,
  PageHeader,
  PageLoader,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from '../../components/ui';

/**
 * Admin: Tutorial Tracking.
 * Per-user watch time / % per tutorial, post-tutorial quiz outcomes (or skips)
 * and the composite performance score — so admins can see who is actually
 * watching the videos vs. skipping through them. Exportable as Excel.
 */

interface TutorialMeta {
  id: number;
  title: string;
  module_number: string;
  stage_title: string;
  stage_order: number;
  duration_minutes: number;
  quiz_question_count: number;
  has_quiz: boolean;
}

interface PerTutorial {
  watch_time_seconds: number;
  watch_pct: number;
  is_completed: boolean;
  completed_at: string | null;
  quiz_status: string;
  quiz_score: number | null;
  quiz_total: number | null;
}

interface UserRow {
  user_id: number;
  name: string;
  email: string;
  tutorials: Record<string, PerTutorial>;
  summary: {
    tutorials_completed: number;
    total_tutorials: number;
    avg_watch_pct: number;
    total_watch_time_seconds: number;
    quizzes_completed: number;
    quizzes_skipped: number;
    quizzes_pending: number;
    quiz_participation_pct: number;
    quiz_accuracy_pct: number;
    performance_score: number;
  };
}

interface TrackingData {
  district: string;
  district_name: string;
  tutorials: TutorialMeta[];
  users: UserRow[];
}

const fmtWatchTime = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const scoreColorClass = (score: number): string =>
  score >= 75 ? 'text-success-600' : score >= 45 ? 'text-amber-600' : 'text-error-600';

const pctColorClass = (pct: number): string =>
  pct >= 90 ? 'text-success-600' : pct >= 40 ? 'text-amber-600' : 'text-error-600';

const quizCell = (p: PerTutorial, meta: TutorialMeta, t: TFunction): string => {
  if (!meta.has_quiz) return '—';
  if (p.quiz_status === 'completed') return `${p.quiz_score ?? 0}/${p.quiz_total ?? meta.quiz_question_count}`;
  if (p.quiz_status === 'skipped') return t('tracking.skipped');
  return t('tracking.pending');
};

const AdminTutorialTrackingPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

  const fetchData = () => {
    setLoading(true);
    client
      .get(`/api/admin/tutorial-tracking?district=${getDistrict()}`)
      .then((res) => {
        setData(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const handleDistrictChange = () => fetchData();
    window.addEventListener('district-changed', handleDistrictChange);
    return () => window.removeEventListener('district-changed', handleDistrictChange);
  }, []);

  const filteredUsers = (data?.users || []).filter(
    (u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  const downloadExcel = () => {
    if (!data) return;
    const headers = [
      t('tracking.excel.userName'),
      t('tracking.excel.email'),
      ...data.tutorials.flatMap((tut) => [
        t('tracking.excel.watchPct', { module: tut.module_number || tut.title }),
        t('tracking.excel.watchTime', { module: tut.module_number || tut.title }),
        t('tracking.excel.quiz', { module: tut.module_number || tut.title }),
      ]),
      t('tracking.excel.tutorialsCompleted'),
      t('tracking.excel.avgWatch'),
      t('tracking.excel.totalWatchTime'),
      t('tracking.excel.quizzesAnswered'),
      t('tracking.excel.quizzesSkipped'),
      t('tracking.excel.quizAccuracy'),
      t('tracking.excel.performanceScore'),
    ];
    const rows = data.users.map((u) => [
      u.name,
      u.email,
      ...data.tutorials.flatMap((tut) => {
        const p = u.tutorials[String(tut.id)];
        return [
          p ? `${p.watch_pct}%` : '0%',
          p ? fmtWatchTime(p.watch_time_seconds) : '0s',
          p ? quizCell(p, tut, t) : tut.has_quiz ? t('tracking.pending') : '—',
        ];
      }),
      `${u.summary.tutorials_completed}/${u.summary.total_tutorials}`,
      u.summary.avg_watch_pct,
      fmtWatchTime(u.summary.total_watch_time_seconds),
      u.summary.quizzes_completed,
      u.summary.quizzes_skipped,
      u.summary.quiz_accuracy_pct,
      u.summary.performance_score,
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, t('tracking.excel.sheet'));
    XLSX.writeFile(wb, `tutorial_tracking_${data.district}.xlsx`);
  };

  if (loading) return <PageLoader label={t('tracking.loading')} />;

  const hasUsers = !!data && data.users.length > 0;

  return (
    <div>
      <PageHeader
        title={t('tracking.title')}
        description={t('tracking.description', { district: data?.district_name || t('tracking.thisDistrict') })}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" iconLeft={<RefreshCw className="size-4" />} onClick={fetchData}>
              {t('tracking.refresh')}
            </Button>
            <Button
              iconLeft={<Download className="size-4" />}
              onClick={downloadExcel}
              disabled={!hasUsers}
            >
              {t('tracking.downloadExcel')}
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="mb-4 max-w-sm">
        <Input
          leftIcon={<Search className="size-4" />}
          placeholder={t('tracking.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!hasUsers ? (
        <EmptyState
          icon={<MonitorPlay className="size-10" />}
          title={t('tracking.emptyTitle')}
          description={t('tracking.emptyBody')}
        />
      ) : (
        <Table
          density="compact"
          className="min-w-max"
          style={{ minWidth: `${520 + data!.tutorials.length * 160}px` }}
        >
          <THead>
            <Tr>
              <Th className="sticky left-0 z-10 bg-surface-sunken text-left">{t('tracking.colUser')}</Th>
              {data!.tutorials.map((tut) => (
                <Th key={tut.id} className="whitespace-nowrap text-center" title={`${tut.stage_title} — ${tut.title}`}>
                  {tut.module_number || tut.title}
                  {tut.has_quiz && <span className="text-primary"> ?</span>}
                </Th>
              ))}
              <Th className="text-center">{t('tracking.colAvgWatch')}</Th>
              <Th className="text-center">{t('tracking.colQuizzes')}</Th>
              <Th className="text-center">{t('tracking.colPerformance')}</Th>
            </Tr>
          </THead>
          <TBody>
            {filteredUsers.map((u) => (
              <Tr key={u.user_id}>
                <Td className="sticky left-0 z-10 whitespace-nowrap bg-surface">
                  <div className="font-semibold text-ink">{u.name}</div>
                  <div className="text-xs text-ink-faint">{u.email}</div>
                </Td>
                {data!.tutorials.map((tut) => {
                  const p = u.tutorials[String(tut.id)];
                  const pct = p?.watch_pct || 0;
                  return (
                    <Td key={tut.id} className="whitespace-nowrap text-center">
                      <div className={`font-bold ${pctColorClass(pct)}`}>{Math.round(pct)}%</div>
                      <div className="text-[0.7rem] text-ink-faint">
                        {fmtWatchTime(p?.watch_time_seconds || 0)}
                        {tut.has_quiz && <> • {p ? quizCell(p, tut, t) : t('tracking.pending')}</>}
                      </div>
                    </Td>
                  );
                })}
                <Td className="text-center font-bold text-ink">{u.summary.avg_watch_pct}%</Td>
                <Td className="whitespace-nowrap text-center text-[0.8125rem]">
                  <span className="text-success-600" title={t('tracking.answered')}>
                    <CheckCircle2 className="mb-0.5 inline size-3" /> {u.summary.quizzes_completed}
                  </span>
                  {' / '}
                  <span className="text-error-600" title={t('tracking.skipped')}>
                    <SkipForward className="mb-0.5 inline size-3" /> {u.summary.quizzes_skipped}
                  </span>
                  <div className="text-[0.7rem] text-ink-faint">{t('tracking.accuracy', { n: u.summary.quiz_accuracy_pct })}</div>
                </Td>
                <Td className="text-center">
                  <span className={`font-display text-base font-extrabold ${scoreColorClass(u.summary.performance_score)}`}>
                    {u.summary.performance_score}
                  </span>
                  <span className="text-[0.7rem] text-ink-faint"> {t('tracking.outOf100')}</span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        {t('tracking.footnote')}
      </p>
    </div>
  );
};

export default AdminTutorialTrackingPage;
