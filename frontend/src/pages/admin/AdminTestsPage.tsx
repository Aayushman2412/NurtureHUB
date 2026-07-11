import React, { useEffect, useState, useRef } from 'react';
import client from '../../api/client';
import * as XLSX from 'xlsx';
import {
  Trash2, Save, Upload, Play, Square, Download, ChevronDown, ChevronUp, FileSpreadsheet, ClipboardList, AlertCircle,
} from 'lucide-react';
import {
  Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, PageLoader, Spinner, Table, TBody, Td, Th, THead, Tr,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import { cn } from '../../utils/cn';
import { SUCCESS_500, ERROR_500, CREAM_100, INK_900 } from '../../utils/brandColors';

interface Question {
  id: number;
  text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  marks: number;
}

interface Test {
  id: number;
  title: string;
  description: string;
  stage_id: number;
  duration_minutes: number;
  passing_score_pct: number;
  max_attempts: number;
  status: string;
  started_at: string | null;
  ended_at: string | null;
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

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="mb-1.5 block text-xs font-semibold text-ink-muted">{children}</label>
);

const hex = (h: string) => h.replace('#', '');

const AdminTestsPage: React.FC = () => {
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTest, setExpandedTest] = useState<number | null>(null);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showResults, setShowResults] = useState<number | null>(null);
  const [resultData, setResultData] = useState<ResultData | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetTest, setUploadTargetTest] = useState<number | null>(null);

  const [newTest, setNewTest] = useState({
    title: '',
    description: '',
    stage_id: 1,
    duration_minutes: 10,
    passing_score_pct: 70,
    max_attempts: 3,
  });

  const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

  const fetchTests = () => {
    client
      .get(`/api/admin/tests?district=${getDistrict()}`)
      .then(res => {
        setTests(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchTests();
    const handleDistrictChange = () => fetchTests();
    window.addEventListener('district-changed', handleDistrictChange);
    return () => window.removeEventListener('district-changed', handleDistrictChange);
  }, []);

  const createTest = () => {
    if (!newTest.title.trim()) return;
    client.post(`/api/admin/tests?district=${getDistrict()}`, { ...newTest, questions: [] }).then(() => {
      fetchTests();
      setShowAddTest(false);
      setNewTest({ title: '', description: '', stage_id: 1, duration_minutes: 10, passing_score_pct: 70, max_attempts: 3 });
    });
  };

  const updateTest = (id: number, updates: Partial<Test>) => {
    client.put(`/api/admin/tests/${id}?district=${getDistrict()}`, updates).then(fetchTests);
  };

  const deleteTest = (id: number) => {
    if (!confirm('Delete this test and all its questions?')) return;
    client.delete(`/api/admin/tests/${id}?district=${getDistrict()}`).then(fetchTests);
  };

  const startTest = (id: number) => {
    client.post(`/api/admin/tests/${id}/start?district=${getDistrict()}`).then(fetchTests);
  };

  const endTest = (id: number) => {
    if (!confirm('End this test now? Users will no longer be able to take it.')) return;
    client.post(`/api/admin/tests/${id}/end?district=${getDistrict()}`).then(fetchTests);
  };

  const viewResults = (testId: number) => {
    setShowResults(testId);
    setResultLoading(true);
    client
      .get(`/api/admin/tests/${testId}/results?district=${getDistrict()}`)
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
      'User Name',
      ...resultData.questions.map((_, i) => `Q${i + 1}`),
      'Total Correct',
      'Total Wrong',
      'Total Unattempted',
      'Score %',
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

    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, `test_${testId}_results.xlsx`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadTargetTest === null) return;

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(sheet);

        const questions: Question[] = json.map((row, idx) => {
          const keys = Object.keys(row);
          return {
            id: idx + 1,
            text: row[keys[0]] || '',
            option_a: row[keys[1]] || '',
            option_b: row[keys[2]] || '',
            option_c: row[keys[3]] || '',
            option_d: row[keys[4]] || '',
            correct_answer: (row[keys[5]] || 'A').toString().toUpperCase(),
            marks: 2,
          };
        });

        if (questions.length > 0) {
          client
            .post(`/api/admin/tests/${uploadTargetTest}/upload-questions?district=${getDistrict()}`, questions)
            .then(fetchTests);
        }
      } catch (err) {
        console.error('Failed to parse file:', err);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
    setUploadTargetTest(null);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">🟢 Active</Badge>;
      case 'ended':
        return <Badge variant="error">🔴 Ended</Badge>;
      default:
        return <Badge variant="neutral">📝 Draft</Badge>;
    }
  };

  if (loading) return <PageLoader label="Loading tests…" />;

  const iconBtn = 'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10';

  const resultCellClass = (val: string) =>
    val === 'correct'
      ? 'bg-success-500 text-white'
      : val === 'wrong'
        ? 'bg-error-500 text-white'
        : 'bg-surface-sunken text-ink-muted';

  return (
    <div>
      <PageHeader
        title="Test Manager"
        description="Upload questions, control test sessions, and download color-coded result sheets."
        actions={
          <Button iconLeft={<ClipboardList className="size-4" />} onClick={() => setShowAddTest(true)}>
            Create Test
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
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-coral-600 dark:text-coral-300">
                    Stage {test.stage_id}
                  </span>
                  {statusBadge(test.status)}
                </div>
                <h3 className="font-display text-lg font-bold text-ink">{test.title}</h3>
                <p className="text-sm text-ink-muted">{test.description}</p>
                <span className="text-xs text-ink-faint">
                  {test.questions.length} questions • {test.duration_minutes}min • Pass: {test.passing_score_pct}%
                </span>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5">
                  {test.status === 'draft' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={<Play className="size-3.5" />}
                      onClick={e => {
                        e.stopPropagation();
                        startTest(test.id);
                      }}
                    >
                      Start
                    </Button>
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
                      End
                    </Button>
                  )}
                  {test.status === 'ended' && (
                    <Button
                      variant="outline"
                      size="sm"
                      iconLeft={<Download className="size-3.5" />}
                      onClick={e => {
                        e.stopPropagation();
                        viewResults(test.id);
                      }}
                    >
                      Results
                    </Button>
                  )}
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
                  <div><Label>Title</Label><Input value={test.title} onChange={e => updateTest(test.id, { title: e.target.value })} /></div>
                  <div><Label>Stage ID</Label><Input type="number" value={test.stage_id} onChange={e => updateTest(test.id, { stage_id: parseInt(e.target.value) || 1 })} /></div>
                  <div><Label>Duration (min)</Label><Input type="number" value={test.duration_minutes} onChange={e => updateTest(test.id, { duration_minutes: parseInt(e.target.value) || 10 })} /></div>
                  <div><Label>Pass %</Label><Input type="number" value={test.passing_score_pct} onChange={e => updateTest(test.id, { passing_score_pct: parseInt(e.target.value) || 70 })} /></div>
                  <div><Label>Max Attempts</Label><Input type="number" value={test.max_attempts} onChange={e => updateTest(test.id, { max_attempts: parseInt(e.target.value) || 3 })} /></div>
                </div>

                {/* Upload */}
                <div className="my-4 flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    iconLeft={<Upload className="size-4" />}
                    onClick={() => {
                      setUploadTargetTest(test.id);
                      fileInputRef.current?.click();
                    }}
                  >
                    Upload Questions (Excel/CSV)
                  </Button>
                  <Alert variant="info" className="flex-1">
                    <span className="flex items-center gap-2">
                      <AlertCircle className="size-3.5" /> Excel format: Question Text | Option A | Option B | Option C |
                      Option D | Correct Answer
                    </span>
                  </Alert>
                </div>

                {/* Questions */}
                {test.questions.length > 0 ? (
                  <Table density="compact">
                    <THead>
                      <Tr>
                        <Th className="w-10">#</Th>
                        <Th>Question</Th>
                        <Th>A</Th>
                        <Th>B</Th>
                        <Th>C</Th>
                        <Th>D</Th>
                        <Th className="w-16">Answer</Th>
                        <Th className="w-14">Marks</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {test.questions.map((q, idx) => (
                        <Tr key={q.id}>
                          <Td className="text-center text-ink-muted">{idx + 1}</Td>
                          <Td>{q.text}</Td>
                          <Td className="text-xs text-ink-muted">{q.option_a}</Td>
                          <Td className="text-xs text-ink-muted">{q.option_b}</Td>
                          <Td className="text-xs text-ink-muted">{q.option_c}</Td>
                          <Td className="text-xs text-ink-muted">{q.option_d}</Td>
                          <Td className="text-center">
                            <Badge variant="coral">{q.correct_answer}</Badge>
                          </Td>
                          <Td className="text-center">{q.marks}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={<FileSpreadsheet />}
                    title="No questions yet"
                    description="Upload an Excel/CSV file to populate questions."
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
        title="Create New Assessment"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddTest(false)}>
              Cancel
            </Button>
            <Button iconLeft={<Save className="size-4" />} onClick={createTest} disabled={!newTest.title.trim()}>
              Create Test
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label>Title *</Label><Input placeholder="e.g. Mid-term Assessment" value={newTest.title} onChange={e => setNewTest({ ...newTest, title: e.target.value })} /></div>
          <div><Label>Stage ID</Label><Input type="number" value={newTest.stage_id} onChange={e => setNewTest({ ...newTest, stage_id: parseInt(e.target.value) || 1 })} /></div>
          <div><Label>Duration (min)</Label><Input type="number" value={newTest.duration_minutes} onChange={e => setNewTest({ ...newTest, duration_minutes: parseInt(e.target.value) || 10 })} /></div>
          <div><Label>Passing %</Label><Input type="number" value={newTest.passing_score_pct} onChange={e => setNewTest({ ...newTest, passing_score_pct: parseInt(e.target.value) || 70 })} /></div>
          <div><Label>Max Attempts</Label><Input type="number" value={newTest.max_attempts} onChange={e => setNewTest({ ...newTest, max_attempts: parseInt(e.target.value) || 3 })} /></div>
        </div>
        <div className="mt-3">
          <Label>Description</Label>
          <textarea
            className={cn(inputClasses(), 'resize-y')}
            rows={3}
            placeholder="Brief description..."
            value={newTest.description}
            onChange={e => setNewTest({ ...newTest, description: e.target.value })}
          />
        </div>
      </Modal>

      {/* Results modal */}
      <Modal
        open={showResults !== null}
        onClose={() => {
          setShowResults(null);
          setResultData(null);
        }}
        size="lg"
        title={`Test Results: ${resultData?.test_title || 'Loading...'}`}
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
                Download Excel (.xlsx)
              </Button>
            </div>
            <Table density="compact">
              <THead>
                <Tr>
                  <Th>User</Th>
                  {resultData.questions.map((_, i) => (
                    <Th key={i} className="text-center">Q{i + 1}</Th>
                  ))}
                  <Th className="text-center">Correct</Th>
                  <Th className="text-center">Wrong</Th>
                  <Th className="text-center">Unatt.</Th>
                  <Th className="text-center">Score</Th>
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
                <span className="size-3 rounded-full bg-success-500" /> Correct
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-error-500" /> Wrong
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-surface-sunken ring-1 ring-border-strong" /> Unattempted
              </span>
            </div>
          </>
        ) : (
          <EmptyState icon={<FileSpreadsheet />} title="No results available" />
        )}
      </Modal>
    </div>
  );
};

export default AdminTestsPage;
