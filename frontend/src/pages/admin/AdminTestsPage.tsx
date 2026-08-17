import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import client from '../../api/client';
import { getProjectSlug, PROJECT_EVENT } from '../../lib/adminProject';
import * as XLSX from 'xlsx';
import {
  Trash2, Save, Upload, Play, Square, Download, ChevronDown, ChevronUp, FileSpreadsheet, ClipboardList,
  AlertCircle, Radio, CalendarClock, Plus, Pencil, ArrowUp, ArrowDown, Image as ImageIcon,
} from 'lucide-react';
import {
  Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, PageLoader, Select, Spinner, Table,
  TBody, Td, Th, THead, Tr, FieldLabel,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import { cn } from '../../utils/cn';
import { resolveAssetUrl } from '../../lib/flowGraph';
import TestQuestionEditor from '../../components/admin/TestQuestionEditor';
import {
  OPTION_LABELS, addQuestion, deleteQuestion as apiDeleteQuestion, emptyQuestionDraft, listPhases,
  moveQuestion, saveQuestion, type AdminPhase, type AdminQuestion,
} from '../../api/adminTests';
import { SUCCESS_500, ERROR_500, CREAM_100, INK_900 } from '../../utils/brandColors';

type Question = AdminQuestion;

interface Test {
  id: number;
  title: string;
  description: string;
  stage_id: number;
  duration_minutes: number;
  passing_score_pct: number;
  max_attempts: number;
  default_marks: number;
  status: string;
  test_type: 'formative' | 'screening' | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  has_submitted_attempts: boolean;
  questions: Question[];
}

interface ResultData {
  test_title: string;
  questions: { id: number; text: string }[];
  results: {
    user_name: string;
    answers: Record<string, string>;
    total_correct: number;
    total_wrong: number;
    total_unattempted: number;
    score_pct: number;
  }[];
}

const hex = (h: string) => h.replace('#', '');

// Convert an ISO datetime to the value shape <input type="datetime-local"> needs.
const toLocalInputValue = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Sheet columns for the question upload. Marks and the image columns are
 *  optional — an old 6-column sheet still imports unchanged. */
const QUESTION_SHEET_HEADERS = [
  'Question Text', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Option F',
  'Correct Answer', 'Marks', 'Question Image URL',
] as const;

/** Header cells are matched ignoring case, spaces and punctuation. */
const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

/** Phase titles often already read "Phase 2: Formative Test"; the badge supplies
 *  the number, so drop a leading "Phase N:" to avoid "Phase 2: Phase 2: …". */
const phaseSuffix = (title?: string) => {
  if (!title) return '';
  const stripped = title.replace(/^\s*phase\s*\d+\s*[:.\-–]?\s*/i, '').trim();
  return stripped ? `: ${stripped}` : '';
};

const AdminTestsPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('adminTests');
  const [tests, setTests] = useState<Test[]>([]);
  const [phases, setPhases] = useState<AdminPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTest, setExpandedTest] = useState<number | null>(null);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showResults, setShowResults] = useState<number | null>(null);
  const [resultData, setResultData] = useState<ResultData | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetTest, setUploadTargetTest] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');

  // Question authoring: which question is open in the editor (0 = the new one)
  const [editingQuestion, setEditingQuestion] = useState<{ testId: number; id: number } | null>(null);
  const [questionDraft, setQuestionDraft] = useState<AdminQuestion>(emptyQuestionDraft());
  const [questionSaving, setQuestionSaving] = useState(false);
  const [questionError, setQuestionError] = useState('');

  const [newTest, setNewTest] = useState({
    title: '',
    description: '',
    stage_id: 1,
    duration_minutes: 10,
    passing_score_pct: 70,
    max_attempts: 3,
    default_marks: 1,
    test_type: '',
  });

  // Scheduling modal state
  const [scheduleTest, setScheduleTest] = useState<Test | null>(null);
  const [scheduleValue, setScheduleValue] = useState('');


  const fetchTests = () => {
    client
      .get(`/api/admin/tests?district=${(getProjectSlug() ?? '')}`)
      .then(res => {
        setTests(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    listPhases().then(setPhases).catch(() => setPhases([]));
  };

  useEffect(() => {
    fetchTests();
    const handleDistrictChange = () => fetchTests();
    window.addEventListener(PROJECT_EVENT, handleDistrictChange);
    return () => window.removeEventListener(PROJECT_EVENT, handleDistrictChange);
  }, []);

  // ── Question authoring ─────────────────────────────────────────────────────

  const openNewQuestion = (testId: number) => {
    setQuestionError('');
    setQuestionDraft(emptyQuestionDraft());
    setEditingQuestion({ testId, id: 0 });
  };

  const openEditQuestion = (testId: number, question: Question) => {
    setQuestionError('');
    setQuestionDraft({ ...question });
    setEditingQuestion({ testId, id: question.id });
  };

  const submitQuestion = async () => {
    if (!editingQuestion) return;
    setQuestionSaving(true);
    setQuestionError('');
    try {
      if (editingQuestion.id === 0) {
        await addQuestion(editingQuestion.testId, questionDraft);
      } else {
        await saveQuestion(editingQuestion.id, questionDraft);
      }
      setEditingQuestion(null);
      fetchTests();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setQuestionError(detail || t('editor.saveFailed'));
    } finally {
      setQuestionSaving(false);
    }
  };

  const removeQuestion = async (question: Question) => {
    if (!confirm(t('confirm.deleteQuestion'))) return;
    try {
      await apiDeleteQuestion(question.id);
      fetchTests();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || t('editor.deleteFailed'));
    }
  };

  const shiftQuestion = async (question: Question, direction: 'up' | 'down') => {
    await moveQuestion(question.id, direction);
    fetchTests();
  };

  const downloadQuestionTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [...QUESTION_SHEET_HEADERS],
      ['Which of these is a complex carbohydrate?', 'Cellulose', 'Glucose', 'Maltose', 'Sucrose', '', '', 'A', '2', ''],
      ['Identify the growth pattern shown in the chart', 'Normal', 'Faltering', 'Catch-up', '', '', '', 'B', '3',
        'https://…/chart.png'],
    ]);
    ws['!cols'] = QUESTION_SHEET_HEADERS.map(h => ({ wch: Math.max(h.length + 4, 16) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');
    XLSX.writeFile(wb, 'nurturehub_test_questions_template.xlsx');
  };

  const createTest = () => {
    if (!newTest.title.trim()) return;
    client
      .post(`/api/admin/tests?district=${(getProjectSlug() ?? '')}`, {
        ...newTest,
        test_type: newTest.test_type || null,
        questions: [],
      })
      .then(() => {
        fetchTests();
        setShowAddTest(false);
        setNewTest({
          title: '', description: '', stage_id: 1, duration_minutes: 10,
          passing_score_pct: 70, max_attempts: 3, default_marks: 1, test_type: '',
        });
      });
  };

  const updateTest = (id: number, updates: Partial<Test>) => {
    client.put(`/api/admin/tests/${id}?district=${(getProjectSlug() ?? '')}`, updates).then(fetchTests);
  };

  const deleteTest = (id: number) => {
    if (!confirm(t('confirm.delete'))) return;
    client.delete(`/api/admin/tests/${id}?district=${(getProjectSlug() ?? '')}`).then(fetchTests);
  };

  const startTest = (id: number) => {
    if (!confirm(t('confirm.start'))) return;
    client.post(`/api/admin/tests/${id}/start?district=${(getProjectSlug() ?? '')}`).then(fetchTests);
  };

  const endTest = (id: number) => {
    if (!confirm(t('confirm.end'))) return;
    client.post(`/api/admin/tests/${id}/end?district=${(getProjectSlug() ?? '')}`).then(fetchTests);
  };

  const openSchedule = (test: Test) => {
    setScheduleValue(toLocalInputValue(test.scheduled_at));
    setScheduleTest(test);
  };

  const saveSchedule = () => {
    if (!scheduleTest) return;
    const iso = scheduleValue ? new Date(scheduleValue).toISOString() : null;
    client
      .put(`/api/admin/tests/${scheduleTest.id}/schedule?district=${(getProjectSlug() ?? '')}`, { scheduled_at: iso })
      .then(() => {
        setScheduleTest(null);
        fetchTests();
      });
  };

  const viewResults = (testId: number) => {
    setShowResults(testId);
    setResultLoading(true);
    client
      .get(`/api/admin/tests/${testId}/results?district=${(getProjectSlug() ?? '')}`)
      .then(res => {
        setResultData(res.data);
        setResultLoading(false);
      })
      .catch(() => setResultLoading(false));
  };

  const downloadResults = (testId: number) => {
    if (!resultData) return;

    const wb = XLSX.utils.book_new();
    const headers = [
      t('excel.userName'),
      ...resultData.questions.map((_, i) => t('qColumn', { n: i + 1 })),
      t('excel.totalCorrect'),
      t('excel.totalWrong'),
      t('excel.totalUnattempted'),
      t('excel.scorePct'),
    ];
    const rows = resultData.results.map(r => {
      const qCols = resultData.questions.map(q => r.answers[`Q${q.id}`] || 'unattempted');
      return [r.user_name, ...qCols, r.total_correct, r.total_wrong, r.total_unattempted, r.score_pct];
    });

    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Color-code cells with the warm-human brand palette (brandColors.ts)
    for (let rowIdx = 1; rowIdx <= rows.length; rowIdx++) {
      for (let colIdx = 1; colIdx <= resultData.questions.length; colIdx++) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
        const cell = ws[cellRef];
        if (cell) {
          const val = (cell.v as string).toLowerCase();
          if (val === 'correct') {
            cell.s = { fill: { fgColor: { rgb: hex(SUCCESS_500) } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
          } else if (val === 'wrong') {
            cell.s = { fill: { fgColor: { rgb: hex(ERROR_500) } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
          } else if (val === 'unattempted') {
            cell.s = { fill: { fgColor: { rgb: hex(CREAM_100) } }, font: { color: { rgb: hex(INK_900) }, bold: true } };
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, t('excel.sheet'));
    XLSX.writeFile(wb, `test_${testId}_results.xlsx`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetTest = uploadTargetTest;
    e.target.value = '';
    setUploadTargetTest(null);
    if (!file || targetTest === null) return;
    setUploadError('');

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });

        const questions = json.map(row => {
          const keys = Object.keys(row);
          // Named columns when the header row matches the template; positional
          // fallback keeps the original 6-column sheets importable.
          const named = (want: string) => {
            const key = keys.find(h => normalizeHeader(h) === want);
            return key ? String(row[key] ?? '').trim() : undefined;
          };
          const at = (i: number) => String(row[keys[i]] ?? '').trim();
          const marksRaw = named('marks') ?? '';
          const parsedMarks = parseInt(marksRaw, 10);
          return {
            text: named('questiontext') ?? at(0),
            option_a: named('optiona') ?? at(1),
            option_b: named('optionb') ?? at(2),
            option_c: named('optionc') ?? at(3),
            option_d: named('optiond') ?? at(4),
            option_e: named('optione') ?? '',
            option_f: named('optionf') ?? '',
            correct_answer: (named('correctanswer') ?? at(5) ?? 'A').toUpperCase() || 'A',
            // Blank / non-numeric Marks => the test's default marks decide.
            marks: Number.isFinite(parsedMarks) && parsedMarks > 0 ? parsedMarks : 0,
            image_url: named('questionimageurl') ?? '',
          };
        }).filter(q => q.text);

        if (questions.length === 0) {
          setUploadError(t('upload.emptySheet'));
          return;
        }
        client
          .post(`/api/admin/tests/${targetTest}/upload-questions?district=${(getProjectSlug() ?? '')}`, questions)
          .then(fetchTests)
          .catch((err: { response?: { data?: { detail?: string } } }) =>
            setUploadError(err?.response?.data?.detail || t('upload.failed')));
      } catch {
        setUploadError(t('upload.parseError'));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">{t('status.active')}</Badge>;
      case 'ended':
        return <Badge variant="error">{t('status.ended')}</Badge>;
      case 'scheduled':
        return <Badge variant="warning">{t('status.scheduled')}</Badge>;
      default:
        return <Badge variant="neutral">{t('status.draft')}</Badge>;
    }
  };

  if (loading) return <PageLoader label={t('loading')} />;

  const iconBtn = 'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10';
  const iconNeutralBtn =
    'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:cursor-not-allowed disabled:opacity-35';

  const resultCellClass = (val: string) =>
    val === 'correct'
      ? 'bg-success-500 text-white'
      : val === 'wrong'
        ? 'bg-error-500 text-white'
        : 'bg-surface-sunken text-ink-muted';

  return (
    <div>
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
        actions={
          <Button iconLeft={<ClipboardList className="size-4" />} onClick={() => setShowAddTest(true)}>
            {t('header.createTest')}
          </Button>
        }
      />

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />

      {/* Tests */}
      <div className="flex flex-col gap-4">
        {tests.map(test => (
          <Card key={test.id} className="overflow-hidden">
            <div
              className="flex cursor-pointer items-start justify-between gap-4 p-5"
              onClick={() => setExpandedTest(expandedTest === test.id ? null : test.id)}
            >
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-coral-600 dark:text-coral-300">
                    {t('card.phase', { n: test.stage_id })}
                    {phaseSuffix(phases[test.stage_id - 1]?.title)}
                  </span>
                  {test.test_type && (
                    <Badge variant="info">
                      {test.test_type === 'formative' ? t('testType.formative') : t('testType.screening')}
                    </Badge>
                  )}
                  {statusBadge(test.status)}
                </div>
                <h3 className="font-display text-lg font-bold text-ink">{test.title}</h3>
                <p className="text-sm text-ink-muted">{test.description}</p>
                <span className="text-xs text-ink-faint">
                  {t('card.meta', {
                    questions: test.questions.length,
                    minutes: test.duration_minutes,
                    pass: test.passing_score_pct,
                  })}
                  {test.scheduled_at && test.status !== 'active' && test.status !== 'ended' && (
                    <> • {t('card.goesLive', { date: new Date(test.scheduled_at).toLocaleString() })}</>
                  )}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {(test.status === 'draft' || test.status === 'scheduled') && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        iconLeft={<CalendarClock className="size-3.5" />}
                        onClick={e => {
                          e.stopPropagation();
                          openSchedule(test);
                        }}
                      >
                        {t('actions.schedule')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        iconLeft={<Play className="size-3.5" />}
                        onClick={e => {
                          e.stopPropagation();
                          startTest(test.id);
                        }}
                      >
                        {t('actions.start')}
                      </Button>
                    </>
                  )}
                  {test.status === 'active' && (
                    <Button
                      variant="danger"
                      size="sm"
                      iconLeft={<Square className="size-3.5" />}
                      onClick={e => {
                        e.stopPropagation();
                        endTest(test.id);
                      }}
                    >
                      {t('actions.end')}
                    </Button>
                  )}
                  {(test.status === 'ended' || test.status === 'active') && (
                    <Button
                      variant="outline"
                      size="sm"
                      iconLeft={<Download className="size-3.5" />}
                      onClick={e => {
                        e.stopPropagation();
                        viewResults(test.id);
                      }}
                    >
                      {t('actions.results')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<Radio className="size-3.5" />}
                    onClick={e => {
                      e.stopPropagation();
                      navigate(`/admin/tests/${test.id}/monitor`);
                    }}
                  >
                    {t('actions.monitorLive')}
                  </Button>
                  <button
                    className={iconBtn}
                    onClick={e => {
                      e.stopPropagation();
                      deleteTest(test.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {expandedTest === test.id ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
              </div>
            </div>

            {expandedTest === test.id && (
              <div className="border-t border-border p-5">
                {/* Settings */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div><FieldLabel size="sm">{t('fields.title')}</FieldLabel><Input value={test.title} onChange={e => updateTest(test.id, { title: e.target.value })} /></div>
                  <div>
                    <FieldLabel size="sm">{t('fields.phase')}</FieldLabel>
                    <Select
                      value={test.stage_id}
                      onChange={e => updateTest(test.id, { stage_id: parseInt(e.target.value, 10) || 1 })}
                    >
                      {phases.map((phase, i) => (
                        <option key={phase.id} value={i + 1}>
                          {t('card.phase', { n: i + 1 })}{phaseSuffix(phase.title)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div><FieldLabel size="sm">{t('fields.duration')}</FieldLabel><Input type="number" value={test.duration_minutes} onChange={e => updateTest(test.id, { duration_minutes: parseInt(e.target.value) || 10 })} /></div>
                  <div><FieldLabel size="sm">{t('fields.passPct')}</FieldLabel><Input type="number" value={test.passing_score_pct} onChange={e => updateTest(test.id, { passing_score_pct: parseInt(e.target.value) || 70 })} /></div>
                  <div><FieldLabel size="sm">{t('fields.maxAttempts')}</FieldLabel><Input type="number" value={test.max_attempts} onChange={e => updateTest(test.id, { max_attempts: parseInt(e.target.value) || 3 })} /></div>
                  <div>
                    <FieldLabel size="sm">{t('fields.defaultMarks')}</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      value={test.default_marks}
                      onChange={e => updateTest(test.id, { default_marks: parseInt(e.target.value, 10) || 1 })}
                    />
                    <p className="mt-1 text-[11px] text-ink-faint">{t('fields.defaultMarksHint')}</p>
                  </div>
                  <div>
                    <FieldLabel size="sm">{t('fields.testType')}</FieldLabel>
                    <Select
                      value={test.test_type || ''}
                      onChange={e => updateTest(test.id, { test_type: (e.target.value || null) as Test['test_type'] })}
                    >
                      <option value="">—</option>
                      <option value="formative">{t('testType.formative')}</option>
                      <option value="screening">{t('testType.screening')}</option>
                    </Select>
                  </div>
                </div>

                {/* Question toolbar */}
                <div className="my-4 flex flex-wrap items-center gap-2">
                  <Button
                    iconLeft={<Plus className="size-4" />}
                    onClick={() => openNewQuestion(test.id)}
                  >
                    {t('editor.addQuestion')}
                  </Button>
                  <Button
                    variant="outline"
                    iconLeft={<Upload className="size-4" />}
                    onClick={() => {
                      setUploadTargetTest(test.id);
                      fileInputRef.current?.click();
                    }}
                  >
                    {t('upload.button')}
                  </Button>
                  <Button
                    variant="secondary"
                    iconLeft={<Download className="size-4" />}
                    onClick={downloadQuestionTemplate}
                  >
                    {t('upload.template')}
                  </Button>
                </div>
                <Alert variant="info">
                  <span className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {t('upload.formatHint')}
                  </span>
                </Alert>
                {uploadError && (
                  <Alert variant="error" className="mt-2">{uploadError}</Alert>
                )}
                {test.has_submitted_attempts && (
                  <Alert variant="warning" className="mt-2">{t('editor.attemptsWarning')}</Alert>
                )}

                {/* New-question editor */}
                {editingQuestion?.testId === test.id && editingQuestion.id === 0 && (
                  <div className="mt-4">
                    <TestQuestionEditor
                      value={questionDraft}
                      onChange={setQuestionDraft}
                      onSave={() => void submitQuestion()}
                      onCancel={() => setEditingQuestion(null)}
                      saving={questionSaving}
                      defaultMarks={test.default_marks}
                      locked={test.has_submitted_attempts}
                      error={questionError}
                    />
                  </div>
                )}

                {/* Questions */}
                {test.questions.length > 0 ? (
                  <div className="mt-4 flex flex-col gap-2">
                    {test.questions.map((q, idx) =>
                      editingQuestion?.testId === test.id && editingQuestion.id === q.id ? (
                        <TestQuestionEditor
                          key={q.id}
                          value={questionDraft}
                          onChange={setQuestionDraft}
                          onSave={() => void submitQuestion()}
                          onCancel={() => setEditingQuestion(null)}
                          saving={questionSaving}
                          defaultMarks={test.default_marks}
                          locked={test.has_submitted_attempts}
                          error={questionError}
                        />
                      ) : (
                        <div key={q.id} className="rounded-xl border border-border p-3">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 w-6 shrink-0 text-center text-xs font-bold text-ink-faint">
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="m-0 text-sm font-semibold text-ink">
                                {q.text}
                                {q.image_url && <ImageIcon className="ml-1.5 inline size-3.5 text-ink-faint" />}
                              </p>
                              {q.image_url && (
                                <img
                                  src={resolveAssetUrl(q.image_url)}
                                  alt=""
                                  className="mt-2 h-20 rounded-lg border border-border object-cover"
                                />
                              )}
                              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                                {OPTION_LABELS.map(label => {
                                  const text = q[`option_${label.toLowerCase()}` as keyof Question] as string;
                                  const img = q[`option_${label.toLowerCase()}_image` as keyof Question] as string;
                                  if (!text && !img) return null;
                                  return (
                                    <span
                                      key={label}
                                      className={cn(
                                        'flex items-center gap-1',
                                        q.correct_answer === label && 'font-bold text-success-600 dark:text-success-400',
                                      )}
                                    >
                                      <span className="font-mono">{label}.</span>
                                      {img && (
                                        <img
                                          src={resolveAssetUrl(img)}
                                          alt=""
                                          className="size-6 rounded border border-border object-cover"
                                        />
                                      )}
                                      {text || (img ? t('editor.pictureOption') : '')}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Badge variant="neutral">{t('editor.marksBadge', { n: q.marks })}</Badge>
                              <button className={iconNeutralBtn} title={t('editor.moveUp')}
                                disabled={idx === 0}
                                onClick={() => void shiftQuestion(q, 'up')}>
                                <ArrowUp className="size-3.5" />
                              </button>
                              <button className={iconNeutralBtn} title={t('editor.moveDown')}
                                disabled={idx === test.questions.length - 1}
                                onClick={() => void shiftQuestion(q, 'down')}>
                                <ArrowDown className="size-3.5" />
                              </button>
                              <button className={iconNeutralBtn} title={t('editor.edit')}
                                onClick={() => openEditQuestion(test.id, q)}>
                                <Pencil className="size-3.5" />
                              </button>
                              <button className={iconBtn} title={t('editor.delete')}
                                onClick={() => void removeQuestion(q)}>
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <EmptyState
                    icon={<FileSpreadsheet />}
                    title={t('questionsEmpty.title')}
                    description={t('questionsEmpty.description')}
                  />
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Add test modal */}
      <Modal
        open={showAddTest}
        onClose={() => setShowAddTest(false)}
        title={t('createModal.title')}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddTest(false)}>
              {t('actions.cancel')}
            </Button>
            <Button iconLeft={<Save className="size-4" />} onClick={createTest} disabled={!newTest.title.trim()}>
              {t('actions.createTest')}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><FieldLabel size="sm">{t('fields.titleRequired')}</FieldLabel><Input placeholder={t('createModal.titlePlaceholder')} value={newTest.title} onChange={e => setNewTest({ ...newTest, title: e.target.value })} /></div>
          <div>
            <FieldLabel size="sm">{t('fields.phase')}</FieldLabel>
            <Select
              value={newTest.stage_id}
              onChange={e => setNewTest({ ...newTest, stage_id: parseInt(e.target.value, 10) || 1 })}
            >
              {phases.map((phase, i) => (
                <option key={phase.id} value={i + 1}>
                  {t('card.phase', { n: i + 1 })}{phaseSuffix(phase.title)}
                </option>
              ))}
            </Select>
          </div>
          <div><FieldLabel size="sm">{t('fields.duration')}</FieldLabel><Input type="number" value={newTest.duration_minutes} onChange={e => setNewTest({ ...newTest, duration_minutes: parseInt(e.target.value) || 10 })} /></div>
          <div><FieldLabel size="sm">{t('fields.passingPct')}</FieldLabel><Input type="number" value={newTest.passing_score_pct} onChange={e => setNewTest({ ...newTest, passing_score_pct: parseInt(e.target.value) || 70 })} /></div>
          <div><FieldLabel size="sm">{t('fields.maxAttempts')}</FieldLabel><Input type="number" value={newTest.max_attempts} onChange={e => setNewTest({ ...newTest, max_attempts: parseInt(e.target.value) || 3 })} /></div>
          <div>
            <FieldLabel size="sm">{t('fields.defaultMarks')}</FieldLabel>
            <Input type="number" min={1} value={newTest.default_marks}
              onChange={e => setNewTest({ ...newTest, default_marks: parseInt(e.target.value, 10) || 1 })} />
          </div>
          <div>
            <FieldLabel size="sm">{t('fields.testType')}</FieldLabel>
            <Select value={newTest.test_type} onChange={e => setNewTest({ ...newTest, test_type: e.target.value })}>
              <option value="">—</option>
              <option value="formative">{t('testType.formative')}</option>
              <option value="screening">{t('testType.screening')}</option>
            </Select>
          </div>
        </div>
        <div className="mt-3">
          <FieldLabel size="sm">{t('fields.description')}</FieldLabel>
          <textarea
            className={cn(inputClasses(), 'resize-y')}
            rows={3}
            placeholder={t('createModal.descPlaceholder')}
            value={newTest.description}
            onChange={e => setNewTest({ ...newTest, description: e.target.value })}
          />
        </div>
      </Modal>

      {/* Schedule modal */}
      <Modal
        open={scheduleTest !== null}
        onClose={() => setScheduleTest(null)}
        title={scheduleTest ? t('scheduleModal.titleWith', { title: scheduleTest.title }) : t('scheduleModal.title')}
        footer={
          <>
            <Button variant="outline" onClick={() => setScheduleValue('')}>
              {t('scheduleModal.clear')}
            </Button>
            <Button variant="outline" onClick={() => setScheduleTest(null)}>
              {t('actions.cancel')}
            </Button>
            <Button iconLeft={<Save className="size-4" />} onClick={saveSchedule}>
              {t('scheduleModal.save')}
            </Button>
          </>
        }
      >
        <p className="mt-0 text-sm text-ink-muted">
          <Trans
            t={t}
            i18nKey="scheduleModal.info"
            components={{ strong: <strong className="text-ink" /> }}
          />
        </p>
        <div className="mt-3">
          <FieldLabel size="sm">{t('scheduleModal.goLiveLabel')}</FieldLabel>
          <Input type="datetime-local" value={scheduleValue} onChange={e => setScheduleValue(e.target.value)} />
        </div>
        {scheduleValue && (
          <p className="mt-2 mb-0 text-sm text-primary-ink">
            {t('scheduleModal.preview', { date: new Date(scheduleValue).toLocaleString() })}
          </p>
        )}
      </Modal>

      {/* Results modal */}
      <Modal
        open={showResults !== null}
        onClose={() => {
          setShowResults(null);
          setResultData(null);
        }}
        size="lg"
        title={t('resultsModal.title', { title: resultData?.test_title || t('resultsModal.loadingTitle') })}
      >
        {resultLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : resultData ? (
          <>
            <div className="mb-4 flex justify-end">
              <Button
                iconLeft={<Download className="size-4" />}
                onClick={() => showResults !== null && downloadResults(showResults)}
              >
                {t('resultsModal.download')}
              </Button>
            </div>
            <Table density="compact">
              <THead>
                <Tr>
                  <Th>{t('resultsModal.table.user')}</Th>
                  {resultData.questions.map((_, i) => (
                    <Th key={i} className="text-center">{t('qColumn', { n: i + 1 })}</Th>
                  ))}
                  <Th className="text-center">{t('resultsModal.table.correct')}</Th>
                  <Th className="text-center">{t('resultsModal.table.wrong')}</Th>
                  <Th className="text-center">{t('resultsModal.table.unattempted')}</Th>
                  <Th className="text-center">{t('resultsModal.table.score')}</Th>
                </Tr>
              </THead>
              <TBody>
                {resultData.results.map((r, ri) => (
                  <Tr key={ri}>
                    <Td className="whitespace-nowrap font-semibold">{r.user_name}</Td>
                    {resultData.questions.map(q => {
                      const val = r.answers[`Q${q.id}`] || 'unattempted';
                      return (
                        <Td key={q.id} className="p-1 text-center">
                          <span
                            className={cn(
                              'flex size-7 items-center justify-center rounded-md text-xs font-bold mx-auto',
                              resultCellClass(val),
                            )}
                          >
                            {val.charAt(0).toUpperCase()}
                          </span>
                        </Td>
                      );
                    })}
                    <Td className="text-center font-bold text-success-600">{r.total_correct}</Td>
                    <Td className="text-center font-bold text-error-600">{r.total_wrong}</Td>
                    <Td className="text-center font-bold text-ink-muted">{r.total_unattempted}</Td>
                    <Td className="text-center font-extrabold">{r.score_pct}%</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-success-500" /> {t('resultsModal.legend.correct')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-error-500" /> {t('resultsModal.legend.wrong')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-surface-sunken ring-1 ring-border-strong" /> {t('resultsModal.legend.unattempted')}
              </span>
            </div>
          </>
        ) : (
          <EmptyState icon={<FileSpreadsheet />} title={t('resultsModal.emptyTitle')} />
        )}
      </Modal>
    </div>
  );
};

export default AdminTestsPage;
