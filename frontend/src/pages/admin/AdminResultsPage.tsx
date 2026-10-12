import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Download, RefreshCw, Upload, Users, CheckCircle2, XCircle,
  GraduationCap, AlertCircle, Trash2, Search, Bell, BarChart3,
} from 'lucide-react';
import client from '../../api/client';
import { getMasdBatches, setLearnerBatch } from '../../api/masd';
import { getProjectSlug, PROJECT_EVENT } from '../../lib/adminProject';
import * as XLSX from 'xlsx';
import {
  Badge, Button, Card, EmptyState, Input, LearnerIdentity, PageHeader, PageLoader,
  Pagination, Table, TBody, Tabs, Td, Th, THead, Tr, useTableLayout,
} from '../../components/ui';
import { matchesLearner } from '../../lib/learnerSearch';
import { guideTerms } from '../../lib/pageGuide';
import { downloadTestAnswers } from '../../api/results';
import ResultsInsights from '../../components/results/ResultsInsights';
import type { LearnerProfile, ResultsData, TestMeta, UserResultRow } from '../../lib/resultsInsights';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../utils/cn';

/**
 * Admin: Results section, in three tabs.
 *  - Insights: the whole project's results as a briefing for managers —
 *    headline numbers, the learner journey, plain-language findings, groups
 *    compared (cadre, block, experience …), each test, each video.
 *  - All learners: one combined table per district — tutorial engagement,
 *    every test's score and anti-cheat summary, flow completion —
 *    downloadable as Excel.
 *  - Face-to-face selection: upload an Excel of selected users (emails) and
 *    every matched user is notified to await further instructions.
 */

type ResultsTab = 'insights' | 'learners' | 'selection';
const TAB_KEY = 'nh_results_tab';

function readTab(): ResultsTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'learners' || v === 'selection' ? v : 'insights';
  } catch {
    return 'insights';
  }
}

interface Selection {
  id: number;
  user_id: number;
  name: string;
  email: string;
  profile?: LearnerProfile;
  selected_at: string | null;
  uploaded_by: string | null;
  notified: boolean;
  /** The F2F training batch (its last day starts the MASD follow-up). */
  batch_id: number | null;
  batch: string | null;
  training_end: string | null;
}

interface UploadSummary {
  matched: string[];
  already_selected: string[];
  unmatched: string[];
}

function testLabel(test: TestMeta, t: TFunction): string {
  if (test.test_type === 'formative') return t('testType.formative');
  if (test.test_type === 'screening') return t('testType.screening');
  return test.title;
}

const scoreColor = (score: number) =>
  score >= 75 ? 'text-success-600' : score >= 45 ? 'text-amber-600' : 'text-error-600';

const AdminResultsPage: React.FC = () => {
  const { t } = useTranslation('adminResults');
  const { showToast } = useToast();
  const [data, setData] = useState<ResultsData | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [batches, setBatches] = useState<{ id: number; name: string; end_date: string }[]>([]);
  const [savingBatch, setSavingBatch] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsPageSize, setResultsPageSize] = useState(25);
  const [f2fPage, setF2fPage] = useState(1);
  const [f2fPageSize, setF2fPageSize] = useState(10);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTabState] = useState<ResultsTab>(readTab);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setTab = (next: ResultsTab) => {
    setTabState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* private mode: just don't remember */ }
  };

  const fetchData = () => {
    setLoading(true);
    // A browser that has never picked a project has none yet on first render;
    // the project switcher picks the default and fires PROJECT_EVENT, which
    // fetches again. Asking now would only earn a 404 and a "failed" toast.
    if (!getProjectSlug()) return;
    Promise.all([
      client.get(`/api/admin/results?district=${(getProjectSlug() ?? '')}`),
      client.get(`/api/admin/results/face-to-face?district=${(getProjectSlug() ?? '')}`),
    ])
      .then(([resultsRes, f2fRes]) => {
        setData(resultsRes.data);
        setSelections(f2fRes.data);
        setLoading(false);
      })
      .catch(() => {
        showToast(t('toasts.loadFailed'), 'error');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
    const handleDistrictChange = () => {
      setResultsPage(1);
      setF2fPage(1);
      fetchData();
    };
    window.addEventListener(PROJECT_EVENT, handleDistrictChange);
    return () => window.removeEventListener(PROJECT_EVENT, handleDistrictChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchable = (u: UserResultRow) => ({
    id: u.user_id, name: u.name, email: u.email, mobile: u.profile?.mobile, cadre: u.profile?.cadre,
    cadreShort: u.profile?.cadre_short, block: u.profile?.block, district: u.profile?.district,
  });
  const filteredUsers = (data?.users || []).filter(u => matchesLearner(search, searchable(u)));
  const [selectionSearch, setSelectionSearch] = useState('');
  const filteredSelections = selections.filter(sel => matchesLearner(selectionSearch, {
    id: sel.user_id, name: sel.name, email: sel.email, mobile: sel.profile?.mobile, cadre: sel.profile?.cadre,
    cadreShort: sel.profile?.cadre_short, block: sel.profile?.block, district: sel.profile?.district,
    extra: [sel.batch],
  }));

  // Column groups the reader can hide (review of 5 Oct 2026: a Layout on every table).
  const learnersLayout = useTableLayout('results_learners', [
    { id: 'place', label: t('table.colPlace') },
    { id: 'videos', label: t('table.colVideos') },
    { id: 'score', label: t('table.colVideoScore') },
    { id: 'tests', label: t('table.colTests') },
    { id: 'flow', label: t('table.colFlowStatus') },
    { id: 'f2f', label: t('table.colFaceToFace') },
  ]);
  const [answersBusy, setAnswersBusy] = useState(false);
  const downloadAnswers = async () => {
    if (!data) return;
    setAnswersBusy(true);
    try {
      await downloadTestAnswers(data.district);
    } catch {
      showToast(t('toasts.answersFailed'), 'error');
    } finally {
      setAnswersBusy(false);
    }
  };

  const paginatedUsers = filteredUsers.slice(
    (resultsPage - 1) * resultsPageSize,
    resultsPage * resultsPageSize,
  );

  const paginatedSelections = filteredSelections.slice(
    (f2fPage - 1) * f2fPageSize,
    f2fPage * f2fPageSize,
  );

  const downloadExcel = () => {
    if (!data) return;
    const headers = [
      t('excel.userId'), t('excel.userName'), t('excel.mobile'), t('excel.cadre'), t('excel.department'),
      t('excel.block'), t('excel.district'), t('excel.email'),
      t('excel.tutorialsCompleted'), t('excel.avgWatch'), t('excel.quizzesAnswered'), t('excel.quizzesSkipped'), t('excel.quizAccuracy'), t('excel.performanceScore'),
      ...data.tests.flatMap(test => {
        const label = testLabel(test, t);
        return [
          t('excel.bestScore', { label }),
          t('excel.attempts', { label }),
          t('excel.passed', { label }),
          t('excel.riskScore', { label }),
          t('excel.tabSwitches', { label }),
          t('excel.fullscreenExits', { label }),
          t('excel.copyPaste', { label }),
          t('excel.flagged', { label }),
        ];
      }),
      t('excel.completedFullFlow'), t('excel.selectedForF2f'),
    ];
    const rows = data.users.map(u => [
      u.user_id, u.name, u.profile?.mobile ?? '', u.profile?.cadre ?? '', u.profile?.department ?? '',
      u.profile?.block ?? '', u.profile?.district ?? '', u.email,
      `${u.summary.tutorials_completed}/${u.summary.total_tutorials}`,
      u.summary.avg_watch_pct,
      u.summary.quizzes_completed,
      u.summary.quizzes_skipped,
      u.summary.quiz_accuracy_pct,
      u.summary.performance_score,
      ...data.tests.flatMap(test => {
        const r = u.tests[String(test.id)];
        return r ? [
          r.best_score ?? '—', r.attempts_count, r.is_passed ? t('excel.yes') : t('excel.no'),
          r.max_risk_score, r.tab_switches, r.fullscreen_exits, r.copy_paste_events,
          r.was_flagged ? t('excel.yes') : t('excel.no'),
        ] : ['—', 0, t('excel.no'), 0, 0, 0, 0, t('excel.no')];
      }),
      u.completed_flow ? t('excel.yes') : t('excel.no'),
      u.face_to_face.selected ? t('excel.yes') : t('excel.no'),
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, t('excel.sheet'));
    // What every column means, for anyone opening the file cold.
    const glossary = XLSX.utils.aoa_to_sheet([
      [t('excel.glossaryTerm'), t('excel.glossaryMeaning')],
      ...guideTerms(t, 'results').map(x => [x.term, x.meaning]),
    ]);
    glossary['!cols'] = [{ wch: 34 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, glossary, t('excel.glossarySheet').slice(0, 31));
    XLSX.writeFile(wb, `results_${data.district}.xlsx`);
  };

  // ── Face-to-face Excel upload ──
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bytes = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(bytes, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: unknown[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // Collect anything that looks like an email from any cell.
        const emails: string[] = [];
        for (const row of json) {
          for (const cell of (row as unknown[])) {
            const value = String(cell ?? '').trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) emails.push(value);
          }
        }

        if (emails.length === 0) {
          setUploadSummary({ matched: [], unmatched: [], already_selected: [] });
          showToast(t('toasts.noEmails'), 'warning');
          return;
        }

        const res = await client.post(
          `/api/admin/results/face-to-face/upload?district=${(getProjectSlug() ?? '')}`,
          { emails, notify: true }
        );
        setUploadSummary(res.data);
        showToast(t('toasts.selectedNotified', { n: res.data.matched.length }), 'success');
        fetchData();
      } catch (err) {
        console.error('Failed to process selection file:', err);
        showToast(t('toasts.processFailed'), 'error');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  /** The selection sheet is one column of emails. Pre-filled with the learners
   *  currently listed, so it starts as a shortlist to trim rather than a blank
   *  page — the upload ignores any extra columns you keep alongside. */
  const downloadSelectionTemplate = () => {
    const rows = (data?.users ?? []).map(u => [u.email, u.name]);
    const ws = XLSX.utils.aoa_to_sheet([
      ['Email', 'Name (ignored on upload)'],
      ...(rows.length > 0 ? rows : [['learner@example.org', 'Example Learner']]),
    ]);
    ws['!cols'] = [{ wch: 34 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Selection');
    XLSX.writeFile(wb, `face_to_face_selection_${data?.district ?? 'project'}.xlsx`);
  };

  // The project's training batches, for the batch column. A failure only
  // hides the pickers; the selection list itself still works.
  useEffect(() => {
    const load = () => {
      const slug = getProjectSlug();
      if (!slug) return;
      getMasdBatches(slug).then(setBatches).catch(() => setBatches([]));
    };
    load();
    window.addEventListener(PROJECT_EVENT, load);
    return () => window.removeEventListener(PROJECT_EVENT, load);
  }, []);

  const changeBatch = (sel: Selection, value: string) => {
    const batchId = value ? Number(value) : null;
    setSavingBatch(sel.user_id);
    setLearnerBatch(sel.user_id, batchId)
      .then(res => {
        setSelections(list => list.map(x => (x.user_id === sel.user_id
          ? { ...x, batch_id: res.batch_id, batch: res.batch, training_end: res.end_date } : x)));
        showToast(t('toasts.batchSaved', { name: sel.name }), 'success');
      })
      .catch(() => showToast(t('toasts.batchFailed'), 'error'))
      .finally(() => setSavingBatch(null));
  };

  const removeSelection = (userId: number) => {
    if (!confirm(t('confirm.removeSelection'))) return;
    client.delete(`/api/admin/results/face-to-face/${userId}`)
      .then(() => {
        showToast(t('toasts.removed'), 'success');
        fetchData();
      })
      .catch(() => showToast(t('toasts.removeFailed'), 'error'));
  };

  if (loading) return <PageLoader label={t('loading')} />;

  return (
    <div>
      <PageHeader
        title={t('header.title')}
        description={t('header.description', { district: data?.district_name || t('header.thisDistrict') })}
        actions={
          <>
            <Button variant="outline" iconLeft={<RefreshCw className="size-4" />} onClick={fetchData}>
              {t('header.refresh')}
            </Button>
            <Button
              variant="outline"
              iconLeft={<Download className="size-4" />}
              loading={answersBusy}
              onClick={() => void downloadAnswers()}
              disabled={!data || data.users.length === 0}
              title={t('header.downloadAnswersHint')}
            >
              {t('header.downloadAnswers')}
            </Button>
            <Button
              iconLeft={<Download className="size-4" />}
              onClick={downloadExcel}
              disabled={!data || data.users.length === 0}
            >
              {t('header.downloadExcel')}
            </Button>
          </>
        }
      />

      <Tabs<ResultsTab>
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'insights', label: t('tabs.insights'), icon: <BarChart3 className="size-4" /> },
          { value: 'learners', label: t('tabs.learners'), icon: <Users className="size-4" /> },
          { value: 'selection', label: t('tabs.selection'), icon: <GraduationCap className="size-4" /> },
        ]}
      />

      {tab === 'insights' && (
        !data || data.users.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="size-10" />}
            title={t('empty.usersTitle')}
            description={t('empty.usersBody')}
          />
        ) : (
          <ResultsInsights key={data.district} data={data} />
        )
      )}

      {tab === 'learners' && (<>
      {/* Search + layout */}
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="w-full max-w-sm">
          <Input
            leftIcon={<Search className="size-4" />}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setResultsPage(1);
            }}
          />
        </div>
        {learnersLayout.controls}
      </div>

      {/* Combined results table */}
      {!data || data.users.length === 0 ? (
        <EmptyState
          icon={<Users className="size-10" />}
          title={t('empty.usersTitle')}
          description={t('empty.usersBody')}
        />
      ) : (
        <div className="mb-8 space-y-3">
          <Table density="compact">
            <THead>
              <Tr>
                <Th className="sticky left-0 z-10 bg-surface-sunken">{t('table.colLearner')}</Th>
                {learnersLayout.show('place') && <Th>{t('table.colPlace')}</Th>}
                {learnersLayout.show('videos') && <Th className="text-center" title={t('table.colVideosHint')}>{t('table.colVideos')}</Th>}
                {learnersLayout.show('score') && <Th className="text-center" title={t('table.colVideoScoreHint')}>{t('table.colVideoScore')}</Th>}
                {learnersLayout.show('tests') && data.tests.map(test => (
                  <Th key={test.id} title={test.title} className="text-center">{t('table.testScore', { label: testLabel(test, t) })}</Th>
                ))}
                {learnersLayout.show('flow') && <Th className="text-center" title={t('table.colFlowStatusHint')}>{t('table.colFlowStatus')}</Th>}
                {learnersLayout.show('f2f') && <Th className="text-center">{t('table.colFaceToFace')}</Th>}
              </Tr>
            </THead>
            <TBody>
              {paginatedUsers.map(u => (
                <Tr key={u.user_id}>
                  <Td className={cn('sticky left-0 z-10 whitespace-nowrap bg-surface', learnersLayout.pad)}>
                    <LearnerIdentity name={u.name} id={u.user_id} mobile={u.profile?.mobile}
                      cadre={u.profile?.cadre_short ?? u.profile?.cadre} email={u.email} />
                  </Td>
                  {learnersLayout.show('place') && (
                    <Td className={cn('whitespace-nowrap text-ink', learnersLayout.pad)}>
                      {[u.profile?.block, u.profile?.district].filter(Boolean).join(', ') || '—'}
                    </Td>
                  )}
                  {learnersLayout.show('videos') && <Td className={cn('whitespace-nowrap text-center', learnersLayout.pad)}>
                    <div className="font-bold text-ink">
                      {u.summary.tutorials_completed}/{u.summary.total_tutorials}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {t('table.watchedLine', { pct: u.summary.avg_watch_pct, done: u.summary.quizzes_completed, skipped: u.summary.quizzes_skipped })}
                    </div>
                  </Td>}
                  {learnersLayout.show('score') && (
                    <Td className={cn('text-center', learnersLayout.pad)}>
                      <span className={cn('font-display font-extrabold', scoreColor(u.summary.performance_score))}>
                        {u.summary.performance_score}
                      </span>
                      <span className="text-xs text-ink-muted">{t('table.outOf100')}</span>
                    </Td>
                  )}
                  {learnersLayout.show('tests') && data.tests.map(test => {
                    const r = u.tests[String(test.id)];
                    if (!r || r.attempts_count === 0) {
                      return <Td key={test.id} className={cn('text-center text-ink-muted', learnersLayout.pad)}>{t('table.notAttempted')}</Td>;
                    }
                    const riskAlert = r.was_flagged || r.max_risk_score >= 50;
                    return (
                      <Td key={test.id} className={cn('whitespace-nowrap text-center', learnersLayout.pad)}>
                        <div className={cn('font-bold', r.is_passed ? 'text-success-600' : 'text-error-600')}>
                          {r.best_score !== null ? `${Math.round(r.best_score)}%` : '—'} {r.is_passed ? '✓' : '✗'}
                        </div>
                        <div className={cn('text-xs', riskAlert ? 'text-error-600' : 'text-ink-muted')}>
                          {t('table.riskLine', { risk: r.max_risk_score, tabs: r.tab_switches, fs: r.fullscreen_exits, cp: r.copy_paste_events })}
                          {r.was_flagged ? ` • ${t('table.flagged')}` : ''}
                        </div>
                      </Td>
                    );
                  })}
                  {learnersLayout.show('flow') && (
                    <Td className={cn('text-center', learnersLayout.pad)}>
                      {u.completed_flow ? (
                        <Badge variant="success" size="sm">{t('status.completed')}</Badge>
                      ) : (
                        <Badge variant="warning" size="sm">{t('status.inProgress')}</Badge>
                      )}
                    </Td>
                  )}
                  {learnersLayout.show('f2f') && (
                    <Td className={cn('text-center', learnersLayout.pad)}>
                      {u.face_to_face.selected ? (
                        <Badge variant="coral" size="sm">{t('status.selected')}</Badge>
                      ) : (
                        <span className="text-sm text-ink-muted">—</span>
                      )}
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            currentPage={resultsPage}
            totalItems={filteredUsers.length}
            pageSize={resultsPageSize}
            onPageChange={setResultsPage}
            onPageSizeChange={setResultsPageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            itemLabel="learners"
          />
        </div>
      )}
      </>)}

      {tab === 'selection' && (<>
      {/* ── Face-to-face selection section ── */}
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GraduationCap className="size-5 text-primary-ink" />
            {t('f2f.title')}
          </span>
        }
        description={`${t('f2f.description')} ${t('f2f.batchHint')}`}
        actions={
          <>
            <Button
              variant="secondary"
              iconLeft={<Download className="size-4" />}
              onClick={downloadSelectionTemplate}
            >
              {t('upload.selectionTemplate')}
            </Button>
            <Button
              iconLeft={<Upload className="size-4" />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? t('f2f.uploading') : t('f2f.uploadButton')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileUpload}
            />
          </>
        }
      />

      {uploadSummary && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap gap-5 text-sm">
            <span className="inline-flex items-center gap-1.5 text-success-600">
              <CheckCircle2 className="size-3.5" /> {t('upload.selectedNotified')} <strong>{uploadSummary.matched.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 text-amber-600">
              <Bell className="size-3.5" /> {t('upload.alreadySelected')} <strong>{uploadSummary.already_selected.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 text-error-600">
              <XCircle className="size-3.5" /> {t('upload.noMatch')} <strong>{uploadSummary.unmatched.length}</strong>
            </span>
          </div>
          {uploadSummary.unmatched.length > 0 && (
            <p className="mt-2 inline-flex items-start gap-1.5 text-sm text-ink-faint">
              <AlertCircle className="size-3.5 shrink-0 translate-y-0.5" /> {t('upload.unmatchedEmails', { emails: uploadSummary.unmatched.join(', ') })}
            </p>
          )}
        </Card>
      )}

      {selections.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-10" />}
          title={t('empty.selectionsTitle')}
          description={t('empty.selectionsBody')}
        />
      ) : (
        <div className="space-y-3">
          <div className="max-w-sm">
            <Input
              leftIcon={<Search className="size-4" />}
              placeholder={t('searchPlaceholder')}
              value={selectionSearch}
              onChange={e => { setSelectionSearch(e.target.value); setF2fPage(1); }}
            />
          </div>
          <Table density="compact">
            <THead>
              <Tr>
                <Th>{t('table.colLearner')}</Th>
                <Th>{t('table.colPlace')}</Th>
                <Th>{t('selectionTable.colSelectedAt')}</Th>
                <Th>{t('selectionTable.colUploadedBy')}</Th>
                <Th>{t('selectionTable.colBatch')}</Th>
                <Th title={t('selectionTable.colMonitorHint')}>{t('selectionTable.colMonitor')}</Th>
                <Th>{t('selectionTable.colNotified')}</Th>
                <Th className="w-16 text-center">{t('selectionTable.colRemove')}</Th>
              </Tr>
            </THead>
            <TBody>
              {paginatedSelections.map(sel => (
                <Tr key={sel.user_id}>
                  <Td>
                    <LearnerIdentity name={sel.name} id={sel.user_id} mobile={sel.profile?.mobile}
                      cadre={sel.profile?.cadre_short ?? sel.profile?.cadre} email={sel.email} />
                  </Td>
                  <Td className="text-ink">{[sel.profile?.block, sel.profile?.district].filter(Boolean).join(', ') || '—'}</Td>
                  <Td className="text-ink-muted">{sel.selected_at ? new Date(sel.selected_at).toLocaleString() : '—'}</Td>
                  <Td className="text-ink-muted">{sel.uploaded_by || '—'}</Td>
                  <Td>
                    {batches.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        <select
                          value={sel.batch_id ?? ''}
                          disabled={savingBatch === sel.user_id}
                          onChange={e => changeBatch(sel, e.target.value)}
                          aria-label={t('selectionTable.batchFor', { name: sel.name })}
                          className="max-w-44 cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
                        >
                          <option value="">{t('selectionTable.projectDate')}</option>
                          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        {sel.training_end && (
                          <span className="text-xs text-ink-faint">
                            {t('selectionTable.ended', { date: new Date(sel.training_end).toLocaleDateString() })}
                          </span>
                        )}
                      </div>
                    ) : <span className="text-xs text-ink-faint">{t('selectionTable.noBatches')}</span>}
                  </Td>
                  <Td className="text-ink">
                    {sel.profile?.is_batch_monitor
                      ? <Badge variant="coral" size="sm">{t('selectionTable.isMonitor')}</Badge>
                      : sel.profile?.batch_monitor ?? <span className="text-ink-muted">—</span>}
                  </Td>
                  <Td>{sel.notified ? <span className="text-success-600">{t('selectionTable.yes')}</span> : t('selectionTable.no')}</Td>
                  <Td className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('selectionTable.removeAria')}
                      title={t('selectionTable.removeAria')}
                      className="text-error-600 hover:text-error-600"
                      onClick={() => removeSelection(sel.user_id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            currentPage={f2fPage}
            totalItems={filteredSelections.length}
            pageSize={f2fPageSize}
            onPageChange={setF2fPage}
            onPageSizeChange={setF2fPageSize}
            pageSizeOptions={[10, 25, 50]}
            itemLabel="selections"
          />
        </div>
      )}
      </>)}
    </div>
  );
};

export default AdminResultsPage;
