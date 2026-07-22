import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Download, RefreshCw, Upload, Users, CheckCircle2, XCircle,
  GraduationCap, AlertCircle, Trash2, Search, Bell,
} from 'lucide-react';
import client from '../../api/client';
import * as XLSX from 'xlsx';
import {
  Badge, Button, Card, EmptyState, Input, PageHeader, PageLoader,
  Table, TBody, Td, Th, THead, Tr,
} from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../utils/cn';

/**
 * Admin: Results section.
 * One combined table per district — tutorial engagement, every test's score and
 * anti-cheat summary, flow completion — downloadable as Excel. Below it, the
 * face-to-face training selection: upload an Excel of selected users (emails)
 * and every matched user is notified to await further instructions.
 */

interface TutorialMeta {
  id: number;
  title: string;
  module_number: string;
  has_quiz: boolean;
}

interface TestMeta {
  id: number;
  title: string;
  test_type: 'formative' | 'screening' | null;
  status: string;
}

interface TestResult {
  attempts_count: number;
  best_score: number | null;
  is_passed: boolean;
  last_submitted_at: string | null;
  max_risk_score: number;
  tab_switches: number;
  fullscreen_exits: number;
  copy_paste_events: number;
  was_flagged: boolean;
}

interface UserRow {
  user_id: number;
  name: string;
  email: string;
  summary: {
    tutorials_completed: number;
    total_tutorials: number;
    avg_watch_pct: number;
    quizzes_completed: number;
    quizzes_skipped: number;
    quiz_accuracy_pct: number;
    performance_score: number;
  };
  tests: Record<string, TestResult>;
  completed_flow: boolean;
  face_to_face: { selected: boolean; selected_at: string | null; notified: boolean };
}

interface ResultsData {
  district: string;
  district_name: string;
  tutorials: TutorialMeta[];
  tests: TestMeta[];
  users: UserRow[];
}

interface Selection {
  user_id: number;
  name: string;
  email: string;
  uploaded_by: string;
  notified: boolean;
  selected_at: string | null;
}

interface UploadSummary {
  matched: string[];
  unmatched: string[];
  already_selected: string[];
}

const testLabel = (test: TestMeta, t: TFunction) =>
  test.test_type === 'formative'
    ? t('testType.formative')
    : test.test_type === 'screening'
      ? t('testType.screening')
      : test.title;

const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

const scoreColor = (score: number) =>
  score >= 75 ? 'text-success-600' : score >= 45 ? 'text-amber-600' : 'text-error-600';

const AdminResultsPage: React.FC = () => {
  const { t } = useTranslation('adminResults');
  const { showToast } = useToast();
  const [data, setData] = useState<ResultsData | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      client.get(`/api/admin/results?district=${getDistrict()}`),
      client.get(`/api/admin/results/face-to-face?district=${getDistrict()}`),
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
    const handleDistrictChange = () => fetchData();
    window.addEventListener('district-changed', handleDistrictChange);
    return () => window.removeEventListener('district-changed', handleDistrictChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredUsers = (data?.users || []).filter(u =>
    !search ||
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const downloadExcel = () => {
    if (!data) return;
    const headers = [
      t('excel.userName'), t('excel.email'),
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
      u.name, u.email,
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
          `/api/admin/results/face-to-face/upload?district=${getDistrict()}`,
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
              iconLeft={<Download className="size-4" />}
              onClick={downloadExcel}
              disabled={!data || data.users.length === 0}
            >
              {t('header.downloadExcel')}
            </Button>
          </>
        }
      />

      {/* Search */}
      <div className="mb-4 max-w-sm">
        <Input
          leftIcon={<Search className="size-4" />}
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Combined results table */}
      {!data || data.users.length === 0 ? (
        <EmptyState
          icon={<Users className="size-10" />}
          title={t('empty.usersTitle')}
          description={t('empty.usersBody')}
        />
      ) : (
        <div className="mb-8">
          <Table density="compact">
            <THead>
              <Tr>
                <Th className="sticky left-0 z-10 bg-surface-sunken">{t('table.colUser')}</Th>
                <Th className="text-center">{t('table.colTutorials')}</Th>
                <Th className="text-center">{t('table.colPerformance')}</Th>
                {data.tests.map(test => (
                  <Th key={test.id} title={test.title} className="text-center">{t('table.testSuffix', { label: testLabel(test, t) })}</Th>
                ))}
                <Th className="text-center">{t('table.colFlowStatus')}</Th>
                <Th className="text-center">{t('table.colFaceToFace')}</Th>
              </Tr>
            </THead>
            <TBody>
              {filteredUsers.map(u => (
                <Tr key={u.user_id}>
                  <Td className="sticky left-0 z-10 whitespace-nowrap bg-surface">
                    <div className="font-semibold text-ink">{u.name}</div>
                    <div className="text-xs text-ink-faint">{u.email}</div>
                  </Td>
                  <Td className="whitespace-nowrap text-center">
                    <div className="font-bold text-ink">
                      {u.summary.tutorials_completed}/{u.summary.total_tutorials}
                    </div>
                    <div className="text-[0.7rem] text-ink-faint">
                      {t('table.watchedLine', { pct: u.summary.avg_watch_pct, done: u.summary.quizzes_completed, skipped: u.summary.quizzes_skipped })}
                    </div>
                  </Td>
                  <Td className="text-center">
                    <span className={cn('font-display font-extrabold', scoreColor(u.summary.performance_score))}>
                      {u.summary.performance_score}
                    </span>
                    <span className="text-[0.7rem] text-ink-faint">{t('table.outOf100')}</span>
                  </Td>
                  {data.tests.map(test => {
                    const r = u.tests[String(test.id)];
                    if (!r || r.attempts_count === 0) {
                      return <Td key={test.id} className="text-center text-ink-faint">{t('table.notAttempted')}</Td>;
                    }
                    const riskAlert = r.was_flagged || r.max_risk_score >= 50;
                    return (
                      <Td key={test.id} className="whitespace-nowrap text-center">
                        <div className={cn('font-bold', r.is_passed ? 'text-success-600' : 'text-error-600')}>
                          {r.best_score !== null ? `${Math.round(r.best_score)}%` : '—'} {r.is_passed ? '✓' : '✗'}
                        </div>
                        <div className={cn('text-[0.7rem]', riskAlert ? 'text-error-600' : 'text-ink-faint')}>
                          {t('table.riskLine', { risk: r.max_risk_score, tabs: r.tab_switches, fs: r.fullscreen_exits, cp: r.copy_paste_events })}
                          {r.was_flagged ? ' • 🚩' : ''}
                        </div>
                      </Td>
                    );
                  })}
                  <Td className="text-center">
                    {u.completed_flow ? (
                      <Badge variant="success" size="sm">{t('status.completed')}</Badge>
                    ) : (
                      <Badge variant="warning" size="sm">{t('status.inProgress')}</Badge>
                    )}
                  </Td>
                  <Td className="text-center">
                    {u.face_to_face.selected ? (
                      <Badge variant="coral" size="sm">{t('status.selected')}</Badge>
                    ) : (
                      <span className="text-sm text-ink-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {/* ── Face-to-face selection section ── */}
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GraduationCap className="size-5 text-primary-ink" />
            {t('f2f.title')}
          </span>
        }
        description={t('f2f.description')}
        actions={
          <>
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
        <Table density="compact">
          <THead>
            <Tr>
              <Th>{t('selectionTable.colUser')}</Th>
              <Th>{t('selectionTable.colEmail')}</Th>
              <Th>{t('selectionTable.colSelectedAt')}</Th>
              <Th>{t('selectionTable.colUploadedBy')}</Th>
              <Th>{t('selectionTable.colNotified')}</Th>
              <Th className="w-16 text-center">{t('selectionTable.colRemove')}</Th>
            </Tr>
          </THead>
          <TBody>
            {selections.map(sel => (
              <Tr key={sel.user_id}>
                <Td className="font-semibold text-ink">{sel.name}</Td>
                <Td className="text-ink-muted">{sel.email}</Td>
                <Td className="text-ink-muted">{sel.selected_at ? new Date(sel.selected_at).toLocaleString() : '—'}</Td>
                <Td className="text-ink-muted">{sel.uploaded_by || '—'}</Td>
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
      )}
    </div>
  );
};

export default AdminResultsPage;
