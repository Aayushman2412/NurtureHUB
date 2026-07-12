import React, { useEffect, useRef, useState } from 'react';
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

const testLabel = (t: TestMeta) =>
  t.test_type === 'formative' ? 'Formative' : t.test_type === 'screening' ? 'Screening' : t.title;

const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

const scoreColor = (score: number) =>
  score >= 75 ? 'text-success-600' : score >= 45 ? 'text-amber-600' : 'text-error-600';

const AdminResultsPage: React.FC = () => {
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
        showToast('Failed to load results.', 'error');
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
      'User Name', 'Email',
      'Tutorials Completed', 'Avg Watch %', 'Quizzes Answered', 'Quizzes Skipped', 'Quiz Accuracy %', 'Performance Score',
      ...data.tests.flatMap(t => [
        `${testLabel(t)} - Best Score %`,
        `${testLabel(t)} - Attempts`,
        `${testLabel(t)} - Passed`,
        `${testLabel(t)} - Risk Score`,
        `${testLabel(t)} - Tab Switches`,
        `${testLabel(t)} - Fullscreen Exits`,
        `${testLabel(t)} - Copy/Paste`,
        `${testLabel(t)} - Flagged`,
      ]),
      'Completed Full Flow', 'Selected for Face-to-Face',
    ];
    const rows = data.users.map(u => [
      u.name, u.email,
      `${u.summary.tutorials_completed}/${u.summary.total_tutorials}`,
      u.summary.avg_watch_pct,
      u.summary.quizzes_completed,
      u.summary.quizzes_skipped,
      u.summary.quiz_accuracy_pct,
      u.summary.performance_score,
      ...data.tests.flatMap(t => {
        const r = u.tests[String(t.id)];
        return r ? [
          r.best_score ?? '—', r.attempts_count, r.is_passed ? 'Yes' : 'No',
          r.max_risk_score, r.tab_switches, r.fullscreen_exits, r.copy_paste_events,
          r.was_flagged ? 'Yes' : 'No',
        ] : ['—', 0, 'No', 0, 0, 0, 0, 'No'];
      }),
      u.completed_flow ? 'Yes' : 'No',
      u.face_to_face.selected ? 'Yes' : 'No',
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Combined Results');
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
          showToast('No email addresses found in the uploaded sheet.', 'warning');
          return;
        }

        const res = await client.post(
          `/api/admin/results/face-to-face/upload?district=${getDistrict()}`,
          { emails, notify: true }
        );
        setUploadSummary(res.data);
        showToast(`Selected & notified ${res.data.matched.length} user(s).`, 'success');
        fetchData();
      } catch (err) {
        console.error('Failed to process selection file:', err);
        showToast('Failed to process the selection file.', 'error');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const removeSelection = (userId: number) => {
    if (!confirm('Remove this user from the face-to-face selection list?')) return;
    client.delete(`/api/admin/results/face-to-face/${userId}`)
      .then(() => {
        showToast('Removed from selection.', 'success');
        fetchData();
      })
      .catch(() => showToast('Failed to remove selection.', 'error'));
  };

  if (loading) return <PageLoader label="Loading results…" />;

  return (
    <div>
      <PageHeader
        title="Results"
        description={`Combined tutorial + test performance for ${data?.district_name || 'this district'}, including anti-cheat summaries. Upload the final selection list to notify users about face-to-face training.`}
        actions={
          <>
            <Button variant="outline" iconLeft={<RefreshCw className="size-4" />} onClick={fetchData}>
              Refresh
            </Button>
            <Button
              iconLeft={<Download className="size-4" />}
              onClick={downloadExcel}
              disabled={!data || data.users.length === 0}
            >
              Download Excel
            </Button>
          </>
        }
      />

      {/* Search */}
      <div className="mb-4 max-w-sm">
        <Input
          leftIcon={<Search className="size-4" />}
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Combined results table */}
      {!data || data.users.length === 0 ? (
        <EmptyState
          icon={<Users className="size-10" />}
          title="No users yet"
          description="No users registered in this district yet."
        />
      ) : (
        <div className="mb-8">
          <Table density="compact">
            <THead>
              <Tr>
                <Th className="sticky left-0 z-10 bg-surface-sunken">User</Th>
                <Th className="text-center">Tutorials</Th>
                <Th className="text-center">Performance</Th>
                {data.tests.map(t => (
                  <Th key={t.id} title={t.title} className="text-center">{testLabel(t)} Test</Th>
                ))}
                <Th className="text-center">Flow Status</Th>
                <Th className="text-center">Face-to-Face</Th>
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
                      {u.summary.avg_watch_pct}% watched • quizzes {u.summary.quizzes_completed}✓ {u.summary.quizzes_skipped}⨯
                    </div>
                  </Td>
                  <Td className="text-center">
                    <span className={cn('font-display font-extrabold', scoreColor(u.summary.performance_score))}>
                      {u.summary.performance_score}
                    </span>
                    <span className="text-[0.7rem] text-ink-faint">/100</span>
                  </Td>
                  {data.tests.map(t => {
                    const r = u.tests[String(t.id)];
                    if (!r || r.attempts_count === 0) {
                      return <Td key={t.id} className="text-center text-ink-faint">Not attempted</Td>;
                    }
                    const riskAlert = r.was_flagged || r.max_risk_score >= 50;
                    return (
                      <Td key={t.id} className="whitespace-nowrap text-center">
                        <div className={cn('font-bold', r.is_passed ? 'text-success-600' : 'text-error-600')}>
                          {r.best_score !== null ? `${Math.round(r.best_score)}%` : '—'} {r.is_passed ? '✓' : '✗'}
                        </div>
                        <div className={cn('text-[0.7rem]', riskAlert ? 'text-error-600' : 'text-ink-faint')}>
                          risk {r.max_risk_score} • tabs {r.tab_switches} • fs {r.fullscreen_exits} • cp {r.copy_paste_events}
                          {r.was_flagged ? ' • 🚩' : ''}
                        </div>
                      </Td>
                    );
                  })}
                  <Td className="text-center">
                    {u.completed_flow ? (
                      <Badge variant="success" size="sm">Completed</Badge>
                    ) : (
                      <Badge variant="warning" size="sm">In progress</Badge>
                    )}
                  </Td>
                  <Td className="text-center">
                    {u.face_to_face.selected ? (
                      <Badge variant="coral" size="sm">Selected</Badge>
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
            <GraduationCap className="size-5 text-primary" />
            Face-to-Face Training Selection
          </span>
        }
        description="Upload an Excel sheet containing the emails of selected users (any column). Every matched user immediately receives a notification that they are selected and should await further instructions."
        actions={
          <>
            <Button
              iconLeft={<Upload className="size-4" />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Upload Selection Excel'}
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
              <CheckCircle2 className="size-3.5" /> Selected &amp; notified: <strong>{uploadSummary.matched.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 text-amber-600">
              <Bell className="size-3.5" /> Already selected: <strong>{uploadSummary.already_selected.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 text-error-600">
              <XCircle className="size-3.5" /> No matching user: <strong>{uploadSummary.unmatched.length}</strong>
            </span>
          </div>
          {uploadSummary.unmatched.length > 0 && (
            <p className="mt-2 inline-flex items-start gap-1.5 text-sm text-ink-faint">
              <AlertCircle className="size-3.5 shrink-0 translate-y-0.5" /> Unmatched emails: {uploadSummary.unmatched.join(', ')}
            </p>
          )}
        </Card>
      )}

      {selections.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-10" />}
          title="No selections yet"
          description="No users selected for face-to-face training yet. Upload an Excel sheet to select and notify them."
        />
      ) : (
        <Table density="compact">
          <THead>
            <Tr>
              <Th>User</Th>
              <Th>Email</Th>
              <Th>Selected At</Th>
              <Th>Uploaded By</Th>
              <Th>Notified</Th>
              <Th className="w-16 text-center">Remove</Th>
            </Tr>
          </THead>
          <TBody>
            {selections.map(sel => (
              <Tr key={sel.user_id}>
                <Td className="font-semibold text-ink">{sel.name}</Td>
                <Td className="text-ink-muted">{sel.email}</Td>
                <Td className="text-ink-muted">{sel.selected_at ? new Date(sel.selected_at).toLocaleString() : '—'}</Td>
                <Td className="text-ink-muted">{sel.uploaded_by || '—'}</Td>
                <Td>{sel.notified ? <span className="text-success-600">Yes</span> : 'No'}</Td>
                <Td className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove from selection"
                    title="Remove from selection"
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
