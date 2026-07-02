import React, { useEffect, useState, useRef } from 'react';
import client from '../../api/client';
import * as XLSX from 'xlsx';
import {
  Plus, Trash2, Edit3, Save, X, Upload, Play, Square,
  Download, ChevronDown, ChevronUp, FileSpreadsheet, ClipboardList, AlertCircle
} from 'lucide-react';

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

const AdminTestsPage: React.FC = () => {
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTest, setExpandedTest] = useState<number | null>(null);
  const [editingTest, setEditingTest] = useState<number | null>(null);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showResults, setShowResults] = useState<number | null>(null);
  const [resultData, setResultData] = useState<ResultData | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetTest, setUploadTargetTest] = useState<number | null>(null);

  // New test form
  const [newTest, setNewTest] = useState({
    title: '', description: '', stage_id: 1, duration_minutes: 10,
    passing_score_pct: 70, max_attempts: 3
  });

  const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

  const fetchTests = () => {
    client.get(`/api/admin/tests?district=${getDistrict()}`)
      .then(res => { setTests(res.data); setLoading(false); })
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
    client.post(`/api/admin/tests?district=${getDistrict()}`, { ...newTest, questions: [] })
      .then(() => {
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
    client.get(`/api/admin/tests/${testId}/results?district=${getDistrict()}`)
      .then(res => { setResultData(res.data); setResultLoading(false); })
      .catch(() => setResultLoading(false));
  };

  const downloadResults = (testId: number) => {
    // Generate XLSX with color-coded cells
    if (!resultData) return;

    const wb = XLSX.utils.book_new();
    const headers = ['User Name', ...resultData.questions.map((_, i) => `Q${i + 1}`), 'Total Correct', 'Total Wrong', 'Total Unattempted', 'Score %'];
    const rows = resultData.results.map(r => {
      const qCols = resultData.questions.map(q => r.answers[`Q${q.id}`] || 'unattempted');
      return [r.user_name, ...qCols, r.total_correct, r.total_wrong, r.total_unattempted, r.score_pct];
    });

    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Apply cell styles (color coding)
    for (let rowIdx = 1; rowIdx <= rows.length; rowIdx++) {
      for (let colIdx = 1; colIdx <= resultData.questions.length; colIdx++) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
        const cell = ws[cellRef];
        if (cell) {
          const val = (cell.v as string).toLowerCase();
          if (val === 'correct') {
            cell.s = { fill: { fgColor: { rgb: '4ADE80' } }, font: { color: { rgb: '065F46' }, bold: true } };
          } else if (val === 'wrong') {
            cell.s = { fill: { fgColor: { rgb: 'F87171' } }, font: { color: { rgb: '7F1D1D' }, bold: true } };
          } else if (val === 'unattempted') {
            cell.s = { fill: { fgColor: { rgb: '374151' } }, font: { color: { rgb: 'D1D5DB' }, bold: true } };
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
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(sheet);

        // Parse columns: Question Text | Option A | Option B | Option C | Option D | Correct Answer
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
            marks: 2
          };
        });

        if (questions.length > 0) {
          client.post(`/api/admin/tests/${uploadTargetTest}/upload-questions?district=${getDistrict()}`, questions)
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

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      draft: { bg: 'rgba(156,163,175,0.15)', color: '#6b7280', label: '📝 Draft' },
      active: { bg: 'rgba(34,197,94,0.15)', color: '#16a34a', label: '🟢 Active' },
      ended: { bg: 'rgba(239,68,68,0.15)', color: '#dc2626', label: '🔴 Ended' }
    };
    const s = styles[status] || styles.draft;
    return <span className="admin-test-status" style={{ backgroundColor: s.bg, color: s.color }}>{s.label}</span>;
  };

  if (loading) return <div className="admin-page"><div className="admin-loading">Loading tests...</div></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Test Manager</h1>
          <p className="admin-page-desc">Upload questions, control test sessions, and download color-coded result sheets.</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAddTest(true)}>
          <ClipboardList size={16} /> Create Test
        </button>
      </div>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />

      {/* Tests List */}
      <div className="admin-stages-list">
        {tests.map((test) => (
          <div key={test.id} className="admin-stage-card">
            <div className="admin-stage-header" onClick={() => setExpandedTest(expandedTest === test.id ? null : test.id)}>
              <div className="admin-stage-info">
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span className="admin-stage-badge">Stage {test.stage_id}</span>
                  {getStatusBadge(test.status)}
                </div>
                <h3 className="admin-stage-title">{test.title}</h3>
                <p className="admin-stage-desc">{test.description}</p>
                <span className="admin-stage-meta">
                  {test.questions.length} questions • {test.duration_minutes}min • Pass: {test.passing_score_pct}%
                </span>
              </div>
              <div className="admin-stage-actions" style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {test.status === 'draft' && (
                    <button className="admin-btn admin-btn-sm" style={{ background: '#16a34a', color: '#fff' }} onClick={e => { e.stopPropagation(); startTest(test.id); }}>
                      <Play size={14} /> Start
                    </button>
                  )}
                  {test.status === 'active' && (
                    <button className="admin-btn admin-btn-sm" style={{ background: '#dc2626', color: '#fff' }} onClick={e => { e.stopPropagation(); endTest(test.id); }}>
                      <Square size={14} /> End
                    </button>
                  )}
                  {test.status === 'ended' && (
                    <button className="admin-btn admin-btn-sm admin-btn-outline" onClick={e => { e.stopPropagation(); viewResults(test.id); }}>
                      <Download size={14} /> Results
                    </button>
                  )}
                  <button className="admin-icon-btn danger" onClick={e => { e.stopPropagation(); deleteTest(test.id); }}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {expandedTest === test.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>
            </div>

            {expandedTest === test.id && (
              <div className="admin-stage-content">
                {/* Test Settings */}
                <div className="admin-test-settings">
                  <div className="admin-field-edit-grid">
                    <div><label className="admin-label">Title</label><input className="admin-input" value={test.title} onChange={e => updateTest(test.id, { title: e.target.value })} /></div>
                    <div><label className="admin-label">Stage ID</label><input className="admin-input" type="number" value={test.stage_id} onChange={e => updateTest(test.id, { stage_id: parseInt(e.target.value) || 1 })} /></div>
                    <div><label className="admin-label">Duration (min)</label><input className="admin-input" type="number" value={test.duration_minutes} onChange={e => updateTest(test.id, { duration_minutes: parseInt(e.target.value) || 10 })} /></div>
                    <div><label className="admin-label">Pass % </label><input className="admin-input" type="number" value={test.passing_score_pct} onChange={e => updateTest(test.id, { passing_score_pct: parseInt(e.target.value) || 70 })} /></div>
                    <div><label className="admin-label">Max Attempts</label><input className="admin-input" type="number" value={test.max_attempts} onChange={e => updateTest(test.id, { max_attempts: parseInt(e.target.value) || 3 })} /></div>
                  </div>
                </div>

                {/* Upload Questions */}
                <div style={{ display: 'flex', gap: '12px', margin: '16px 0' }}>
                  <button
                    className="admin-btn admin-btn-outline"
                    onClick={() => { setUploadTargetTest(test.id); fileInputRef.current?.click(); }}
                  >
                    <Upload size={16} /> Upload Questions (Excel/CSV)
                  </button>
                  <div className="admin-upload-hint">
                    <AlertCircle size={14} />
                    <span>Excel format: Question Text | Option A | Option B | Option C | Option D | Correct Answer</span>
                  </div>
                </div>

                {/* Questions Table */}
                {test.questions.length > 0 ? (
                  <div className="admin-table-wrapper">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}>#</th>
                          <th>Question</th>
                          <th>A</th>
                          <th>B</th>
                          <th>C</th>
                          <th>D</th>
                          <th style={{ width: '70px' }}>Answer</th>
                          <th style={{ width: '60px' }}>Marks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {test.questions.map((q, idx) => (
                          <tr key={q.id}>
                            <td className="admin-td-center">{idx + 1}</td>
                            <td>{q.text}</td>
                            <td className="admin-td-sm">{q.option_a}</td>
                            <td className="admin-td-sm">{q.option_b}</td>
                            <td className="admin-td-sm">{q.option_c}</td>
                            <td className="admin-td-sm">{q.option_d}</td>
                            <td className="admin-td-center"><span className="admin-correct-badge">{q.correct_answer}</span></td>
                            <td className="admin-td-center">{q.marks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-empty-state">
                    <FileSpreadsheet size={40} />
                    <p>No questions added yet. Upload an Excel/CSV file to populate questions.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Test Modal */}
      {showAddTest && (
        <div className="admin-modal-backdrop" onClick={() => setShowAddTest(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Create New Assessment</h3>
              <button onClick={() => setShowAddTest(false)} className="admin-icon-btn"><X size={20} /></button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-field-edit-grid">
                <div><label className="admin-label">Title *</label><input className="admin-input" placeholder="e.g. Mid-term Assessment" value={newTest.title} onChange={e => setNewTest({ ...newTest, title: e.target.value })} /></div>
                <div><label className="admin-label">Stage ID</label><input className="admin-input" type="number" value={newTest.stage_id} onChange={e => setNewTest({ ...newTest, stage_id: parseInt(e.target.value) || 1 })} /></div>
                <div><label className="admin-label">Duration (min)</label><input className="admin-input" type="number" value={newTest.duration_minutes} onChange={e => setNewTest({ ...newTest, duration_minutes: parseInt(e.target.value) || 10 })} /></div>
                <div><label className="admin-label">Passing %</label><input className="admin-input" type="number" value={newTest.passing_score_pct} onChange={e => setNewTest({ ...newTest, passing_score_pct: parseInt(e.target.value) || 70 })} /></div>
                <div><label className="admin-label">Max Attempts</label><input className="admin-input" type="number" value={newTest.max_attempts} onChange={e => setNewTest({ ...newTest, max_attempts: parseInt(e.target.value) || 3 })} /></div>
              </div>
              <div style={{ marginTop: '12px' }}>
                <label className="admin-label">Description</label>
                <textarea className="admin-input" rows={3} placeholder="Brief description..." value={newTest.description} onChange={e => setNewTest({ ...newTest, description: e.target.value })} />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-outline" onClick={() => setShowAddTest(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={createTest} disabled={!newTest.title.trim()}>
                <Save size={16} /> Create Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Modal */}
      {showResults !== null && (
        <div className="admin-modal-backdrop" onClick={() => { setShowResults(null); setResultData(null); }}>
          <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Test Results: {resultData?.test_title || 'Loading...'}</h3>
              <button onClick={() => { setShowResults(null); setResultData(null); }} className="admin-icon-btn"><X size={20} /></button>
            </div>
            <div className="admin-modal-body">
              {resultLoading ? (
                <div className="admin-loading">Loading results...</div>
              ) : resultData ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                    <button className="admin-btn admin-btn-primary" onClick={() => downloadResults(showResults)}>
                      <Download size={16} /> Download Excel (.xlsx)
                    </button>
                  </div>
                  <div className="admin-table-wrapper">
                    <table className="admin-table admin-results-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          {resultData.questions.map((_, i) => <th key={i}>Q{i + 1}</th>)}
                          <th>Correct</th>
                          <th>Wrong</th>
                          <th>Unattempted</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultData.results.map((r, ri) => (
                          <tr key={ri}>
                            <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.user_name}</td>
                            {resultData.questions.map(q => {
                              const val = r.answers[`Q${q.id}`] || 'unattempted';
                              const cls = val === 'correct' ? 'result-correct' : val === 'wrong' ? 'result-wrong' : 'result-unattempted';
                              return <td key={q.id} className={`admin-result-cell ${cls}`}>{val.charAt(0).toUpperCase()}</td>;
                            })}
                            <td className="admin-td-center" style={{ fontWeight: 700, color: '#16a34a' }}>{r.total_correct}</td>
                            <td className="admin-td-center" style={{ fontWeight: 700, color: '#dc2626' }}>{r.total_wrong}</td>
                            <td className="admin-td-center" style={{ fontWeight: 700, color: '#6b7280' }}>{r.total_unattempted}</td>
                            <td className="admin-td-center" style={{ fontWeight: 800 }}>{r.score_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-result-legend">
                    <span><span className="admin-legend-dot" style={{ background: '#4ade80' }} /> Correct</span>
                    <span><span className="admin-legend-dot" style={{ background: '#f87171' }} /> Wrong</span>
                    <span><span className="admin-legend-dot" style={{ background: '#374151' }} /> Unattempted</span>
                  </div>
                </>
              ) : (
                <div className="admin-empty-state"><p>No results available.</p></div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTestsPage;
