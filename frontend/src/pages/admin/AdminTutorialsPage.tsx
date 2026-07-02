import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import { Plus, Trash2, Edit3, Save, X, ChevronDown, ChevronUp, Video, Play, Layers } from 'lucide-react';

interface Tutorial {
  id: number;
  title: string;
  description: string;
  module_number: string;
  duration_minutes: number;
  youtube_url: string;
  start_seconds: number;
  end_seconds: number;
  order_index: number;
}

interface Stage {
  id: number;
  title: string;
  description: string;
  order_index: number;
  tutorials: Tutorial[];
}

const extractYouTubeId = (url: string): string => {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : '';
};

const formatTime = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const AdminTutorialsPage: React.FC = () => {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [editingTutorial, setEditingTutorial] = useState<number | null>(null);
  const [showAddStage, setShowAddStage] = useState(false);
  const [showAddTutorial, setShowAddTutorial] = useState<number | null>(null);
  const [previewVideoId, setPreviewVideoId] = useState<string>('');
  const [previewStart, setPreviewStart] = useState(0);
  const [previewEnd, setPreviewEnd] = useState(0);

  // New stage form
  const [newStageTitle, setNewStageTitle] = useState('');
  const [newStageDesc, setNewStageDesc] = useState('');

  // New tutorial form
  const [newTut, setNewTut] = useState<Partial<Tutorial>>({
    title: '', description: '', module_number: '', duration_minutes: 5,
    youtube_url: '', start_seconds: 0, end_seconds: 120
  });

  const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

  const fetchStages = () => {
    client.get(`/api/admin/stages?district=${getDistrict()}`)
      .then(res => { setStages(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchStages();
    const handleDistrictChange = () => fetchStages();
    window.addEventListener('district-changed', handleDistrictChange);
    return () => window.removeEventListener('district-changed', handleDistrictChange);
  }, []);

  const addStage = () => {
    if (!newStageTitle.trim()) return;
    client.post(`/api/admin/stages?district=${getDistrict()}`, { title: newStageTitle, description: newStageDesc })
      .then(() => { fetchStages(); setShowAddStage(false); setNewStageTitle(''); setNewStageDesc(''); });
  };

  const deleteStage = (id: number) => {
    if (!confirm('Delete this stage and all its tutorials?')) return;
    client.delete(`/api/admin/stages/${id}?district=${getDistrict()}`).then(fetchStages);
  };

  const updateStage = (id: number, updates: Partial<Stage>) => {
    client.put(`/api/admin/stages/${id}?district=${getDistrict()}`, updates).then(fetchStages);
  };

  const addTutorial = (stageId: number) => {
    if (!newTut.title?.trim()) return;
    client.post(`/api/admin/stages/${stageId}/tutorials?district=${getDistrict()}`, newTut)
      .then(() => {
        fetchStages();
        setShowAddTutorial(null);
        setNewTut({ title: '', description: '', module_number: '', duration_minutes: 5, youtube_url: '', start_seconds: 0, end_seconds: 120 });
      });
  };

  const updateTutorial = (id: number, updates: Partial<Tutorial>) => {
    client.put(`/api/admin/tutorials/${id}?district=${getDistrict()}`, updates).then(fetchStages);
  };

  const deleteTutorial = (id: number) => {
    if (!confirm('Delete this tutorial?')) return;
    client.delete(`/api/admin/tutorials/${id}?district=${getDistrict()}`).then(fetchStages);
  };

  const openPreview = (url: string, start: number, end: number) => {
    const videoId = extractYouTubeId(url);
    if (videoId) {
      setPreviewVideoId(videoId);
      setPreviewStart(start);
      setPreviewEnd(end);
    }
  };

  if (loading) return <div className="admin-page"><div className="admin-loading">Loading tutorials...</div></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Tutorial & Stage Manager</h1>
          <p className="admin-page-desc">Manage training stages, upload YouTube tutorials with custom clip ranges.</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAddStage(true)}>
          <Layers size={16} /> Add Stage
        </button>
      </div>

      {/* Video Preview */}
      {previewVideoId && (
        <div className="admin-video-preview">
          <div className="admin-preview-header">
            <h3><Play size={16} /> Video Preview (Clipped)</h3>
            <button className="admin-icon-btn" onClick={() => setPreviewVideoId('')}><X size={18} /></button>
          </div>
          <div className="admin-video-container">
            <iframe
              src={`https://www.youtube.com/embed/${previewVideoId}?start=${previewStart}&end=${previewEnd}&autoplay=1`}
              frameBorder="0"
              allow="autoplay; encrypted-media"
              allowFullScreen
              style={{ width: '100%', height: '100%', borderRadius: '8px' }}
            />
          </div>
          <p className="admin-video-meta">
            Clip: {formatTime(previewStart)} → {formatTime(previewEnd)} ({formatTime(previewEnd - previewStart)} duration)
          </p>
        </div>
      )}

      {/* Stages List */}
      <div className="admin-stages-list">
        {stages.map((stage) => (
          <div key={stage.id} className="admin-stage-card">
            <div className="admin-stage-header" onClick={() => setExpandedStage(expandedStage === stage.id ? null : stage.id)}>
              <div className="admin-stage-info">
                <span className="admin-stage-badge">Stage {stage.order_index + 1}</span>
                <h3 className="admin-stage-title">{stage.title}</h3>
                <p className="admin-stage-desc">{stage.description}</p>
                <span className="admin-stage-meta">{stage.tutorials.length} tutorials</span>
              </div>
              <div className="admin-stage-actions">
                <button className="admin-icon-btn danger" onClick={e => { e.stopPropagation(); deleteStage(stage.id); }} title="Delete stage"><Trash2 size={16} /></button>
                {expandedStage === stage.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>
            </div>

            {expandedStage === stage.id && (
              <div className="admin-stage-content">
                {/* Tutorials */}
                {stage.tutorials.map((tut) => (
                  <div key={tut.id} className="admin-tutorial-card">
                    <div className="admin-tutorial-header">
                      <Video size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <span className="admin-tutorial-title">{tut.title}</span>
                        <span className="admin-tutorial-meta">{tut.module_number} • {tut.duration_minutes}min • Clip: {formatTime(tut.start_seconds)}-{formatTime(tut.end_seconds)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="admin-icon-btn" onClick={() => openPreview(tut.youtube_url, tut.start_seconds, tut.end_seconds)} title="Preview"><Play size={14} /></button>
                        <button className="admin-icon-btn" onClick={() => setEditingTutorial(editingTutorial === tut.id ? null : tut.id)} title="Edit"><Edit3 size={14} /></button>
                        <button className="admin-icon-btn danger" onClick={() => deleteTutorial(tut.id)} title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>

                    {editingTutorial === tut.id && (
                      <div className="admin-tutorial-edit">
                        <div className="admin-field-edit-grid">
                          <div><label className="admin-label">Title</label><input className="admin-input" value={tut.title} onChange={e => updateTutorial(tut.id, { title: e.target.value })} /></div>
                          <div><label className="admin-label">Module #</label><input className="admin-input" value={tut.module_number} onChange={e => updateTutorial(tut.id, { module_number: e.target.value })} /></div>
                          <div><label className="admin-label">YouTube URL</label><input className="admin-input" value={tut.youtube_url} onChange={e => updateTutorial(tut.id, { youtube_url: e.target.value })} /></div>
                          <div><label className="admin-label">Duration (min)</label><input className="admin-input" type="number" value={tut.duration_minutes} onChange={e => updateTutorial(tut.id, { duration_minutes: parseInt(e.target.value) || 0 })} /></div>
                          <div><label className="admin-label">Start (seconds)</label><input className="admin-input" type="number" value={tut.start_seconds} onChange={e => updateTutorial(tut.id, { start_seconds: parseInt(e.target.value) || 0 })} /></div>
                          <div><label className="admin-label">End (seconds)</label><input className="admin-input" type="number" value={tut.end_seconds} onChange={e => updateTutorial(tut.id, { end_seconds: parseInt(e.target.value) || 0 })} /></div>
                        </div>
                        <div style={{ marginTop: '8px' }}>
                          <label className="admin-label">Description</label>
                          <textarea className="admin-input" rows={2} value={tut.description} onChange={e => updateTutorial(tut.id, { description: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Tutorial */}
                {showAddTutorial === stage.id ? (
                  <div className="admin-add-tutorial-form">
                    <h4 style={{ color: '#6366f1', fontWeight: 700, marginBottom: '12px' }}>Add New Tutorial</h4>
                    <div className="admin-field-edit-grid">
                      <div><label className="admin-label">Title *</label><input className="admin-input" placeholder="Tutorial title" value={newTut.title} onChange={e => setNewTut({ ...newTut, title: e.target.value })} /></div>
                      <div><label className="admin-label">Module #</label><input className="admin-input" placeholder="Module 1.4" value={newTut.module_number} onChange={e => setNewTut({ ...newTut, module_number: e.target.value })} /></div>
                      <div><label className="admin-label">YouTube URL *</label><input className="admin-input" placeholder="https://youtube.com/watch?v=..." value={newTut.youtube_url} onChange={e => setNewTut({ ...newTut, youtube_url: e.target.value })} /></div>
                      <div><label className="admin-label">Duration (min)</label><input className="admin-input" type="number" value={newTut.duration_minutes} onChange={e => setNewTut({ ...newTut, duration_minutes: parseInt(e.target.value) || 0 })} /></div>
                      <div><label className="admin-label">Start (seconds)</label><input className="admin-input" type="number" value={newTut.start_seconds} onChange={e => setNewTut({ ...newTut, start_seconds: parseInt(e.target.value) || 0 })} /></div>
                      <div><label className="admin-label">End (seconds)</label><input className="admin-input" type="number" value={newTut.end_seconds} onChange={e => setNewTut({ ...newTut, end_seconds: parseInt(e.target.value) || 0 })} /></div>
                    </div>
                    <div style={{ marginTop: '8px' }}>
                      <label className="admin-label">Description</label>
                      <textarea className="admin-input" rows={2} placeholder="Brief description..." value={newTut.description} onChange={e => setNewTut({ ...newTut, description: e.target.value })} />
                    </div>
                    {newTut.youtube_url && extractYouTubeId(newTut.youtube_url || '') && (
                      <div style={{ marginTop: '12px' }}>
                        <button className="admin-btn admin-btn-outline admin-btn-sm" onClick={() => openPreview(newTut.youtube_url || '', newTut.start_seconds || 0, newTut.end_seconds || 120)}>
                          <Play size={14} /> Preview Clip
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
                      <button className="admin-btn admin-btn-outline" onClick={() => setShowAddTutorial(null)}>Cancel</button>
                      <button className="admin-btn admin-btn-primary" onClick={() => addTutorial(stage.id)} disabled={!newTut.title?.trim()}>
                        <Save size={16} /> Add Tutorial
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="admin-add-btn" onClick={() => setShowAddTutorial(stage.id)}>
                    <Plus size={16} /> Add Tutorial to this Stage
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Stage Modal */}
      {showAddStage && (
        <div className="admin-modal-backdrop" onClick={() => setShowAddStage(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Add New Training Stage</h3>
              <button onClick={() => setShowAddStage(false)} className="admin-icon-btn"><X size={20} /></button>
            </div>
            <div className="admin-modal-body">
              <div><label className="admin-label">Stage Title *</label><input className="admin-input" placeholder="e.g. Advanced Field Operations" value={newStageTitle} onChange={e => setNewStageTitle(e.target.value)} /></div>
              <div style={{ marginTop: '12px' }}><label className="admin-label">Description</label><textarea className="admin-input" rows={3} placeholder="What learners will cover..." value={newStageDesc} onChange={e => setNewStageDesc(e.target.value)} /></div>
            </div>
            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-outline" onClick={() => setShowAddStage(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={addStage} disabled={!newStageTitle.trim()}>
                <Layers size={16} /> Create Stage
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTutorialsPage;
