import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import { Plus, Trash2, Edit3, Save, X, ChevronDown, ChevronUp, Video, Play, Layers } from 'lucide-react';
import { Button, Card, Input, Modal, PageHeader, PageLoader } from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import { cn } from '../../utils/cn';

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

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="mb-1.5 block text-xs font-semibold text-ink-muted">{children}</label>
);

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

  const [newStageTitle, setNewStageTitle] = useState('');
  const [newStageDesc, setNewStageDesc] = useState('');

  const [newTut, setNewTut] = useState<Partial<Tutorial>>({
    title: '',
    description: '',
    module_number: '',
    duration_minutes: 5,
    youtube_url: '',
    start_seconds: 0,
    end_seconds: 120,
  });

  const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

  const fetchStages = () => {
    client
      .get(`/api/admin/stages?district=${getDistrict()}`)
      .then(res => {
        setStages(res.data);
        setLoading(false);
      })
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
    client
      .post(`/api/admin/stages?district=${getDistrict()}`, { title: newStageTitle, description: newStageDesc })
      .then(() => {
        fetchStages();
        setShowAddStage(false);
        setNewStageTitle('');
        setNewStageDesc('');
      });
  };

  const deleteStage = (id: number) => {
    if (!confirm('Delete this stage and all its tutorials?')) return;
    client.delete(`/api/admin/stages/${id}?district=${getDistrict()}`).then(fetchStages);
  };

  const addTutorial = (stageId: number) => {
    if (!newTut.title?.trim()) return;
    client.post(`/api/admin/stages/${stageId}/tutorials?district=${getDistrict()}`, newTut).then(() => {
      fetchStages();
      setShowAddTutorial(null);
      setNewTut({
        title: '',
        description: '',
        module_number: '',
        duration_minutes: 5,
        youtube_url: '',
        start_seconds: 0,
        end_seconds: 120,
      });
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

  if (loading) return <PageLoader label="Loading tutorials…" />;

  const iconBtn = 'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer';

  const editGrid = (fields: React.ReactNode) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields}</div>
  );

  return (
    <div>
      <PageHeader
        title="Tutorial & Stage Manager"
        description="Manage training stages, upload YouTube tutorials with custom clip ranges."
        actions={
          <Button iconLeft={<Layers className="size-4" />} onClick={() => setShowAddStage(true)}>
            Add Stage
          </Button>
        }
      />

      {/* Video preview */}
      {previewVideoId && (
        <Card className="mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display font-bold text-ink">
              <Play className="size-4 text-coral-600 dark:text-coral-300" /> Video Preview (Clipped)
            </h3>
            <button className={iconBtn} onClick={() => setPreviewVideoId('')}>
              <X className="size-4.5" />
            </button>
          </div>
          <div className="aspect-video overflow-hidden rounded-lg bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${previewVideoId}?start=${previewStart}&end=${previewEnd}&autoplay=1`}
              allow="autoplay; encrypted-media"
              allowFullScreen
              className="size-full"
            />
          </div>
          <p className="mt-2 text-[13px] text-ink-muted">
            Clip: {formatTime(previewStart)} → {formatTime(previewEnd)} ({formatTime(previewEnd - previewStart)} duration)
          </p>
        </Card>
      )}

      {/* Stages */}
      <div className="flex flex-col gap-4">
        {stages.map(stage => (
          <Card key={stage.id} className="overflow-hidden">
            <button
              className="flex w-full items-start justify-between gap-4 p-5 text-left"
              onClick={() => setExpandedStage(expandedStage === stage.id ? null : stage.id)}
            >
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-coral-600 dark:text-coral-300">
                  Stage {stage.order_index + 1}
                </span>
                <h3 className="mt-0.5 font-display text-lg font-bold text-ink">{stage.title}</h3>
                <p className="text-sm text-ink-muted">{stage.description}</p>
                <span className="text-xs text-ink-faint">{stage.tutorials.length} tutorials</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  role="button"
                  tabIndex={0}
                  className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10"
                  onClick={e => {
                    e.stopPropagation();
                    deleteStage(stage.id);
                  }}
                  title="Delete stage"
                >
                  <Trash2 className="size-4" />
                </span>
                {expandedStage === stage.id ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
              </div>
            </button>

            {expandedStage === stage.id && (
              <div className="flex flex-col gap-3 border-t border-border p-5">
                {stage.tutorials.map(tut => (
                  <div key={tut.id} className="rounded-xl border border-border bg-surface-sunken/40 p-4">
                    <div className="flex items-center gap-3">
                      <Video className="size-4 shrink-0 text-coral-600 dark:text-coral-300" />
                      <div className="flex-1 min-w-0">
                        <span className="block truncate font-semibold text-ink">{tut.title}</span>
                        <span className="text-xs text-ink-faint">
                          {tut.module_number} • {tut.duration_minutes}min • Clip: {formatTime(tut.start_seconds)}-
                          {formatTime(tut.end_seconds)}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className={iconBtn}
                          onClick={() => openPreview(tut.youtube_url, tut.start_seconds, tut.end_seconds)}
                          title="Preview"
                        >
                          <Play className="size-3.5" />
                        </button>
                        <button
                          className={iconBtn}
                          onClick={() => setEditingTutorial(editingTutorial === tut.id ? null : tut.id)}
                          title="Edit"
                        >
                          <Edit3 className="size-3.5" />
                        </button>
                        <button
                          className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10"
                          onClick={() => deleteTutorial(tut.id)}
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    {editingTutorial === tut.id && (
                      <div className="mt-4 border-t border-border pt-4">
                        {editGrid(
                          <>
                            <div><Label>Title</Label><Input value={tut.title} onChange={e => updateTutorial(tut.id, { title: e.target.value })} /></div>
                            <div><Label>Module #</Label><Input value={tut.module_number} onChange={e => updateTutorial(tut.id, { module_number: e.target.value })} /></div>
                            <div><Label>YouTube URL</Label><Input value={tut.youtube_url} onChange={e => updateTutorial(tut.id, { youtube_url: e.target.value })} /></div>
                            <div><Label>Duration (min)</Label><Input type="number" value={tut.duration_minutes} onChange={e => updateTutorial(tut.id, { duration_minutes: parseInt(e.target.value) || 0 })} /></div>
                            <div><Label>Start (seconds)</Label><Input type="number" value={tut.start_seconds} onChange={e => updateTutorial(tut.id, { start_seconds: parseInt(e.target.value) || 0 })} /></div>
                            <div><Label>End (seconds)</Label><Input type="number" value={tut.end_seconds} onChange={e => updateTutorial(tut.id, { end_seconds: parseInt(e.target.value) || 0 })} /></div>
                          </>,
                        )}
                        <div className="mt-3">
                          <Label>Description</Label>
                          <textarea
                            className={cn(inputClasses(), 'resize-y')}
                            rows={2}
                            value={tut.description}
                            onChange={e => updateTutorial(tut.id, { description: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add tutorial */}
                {showAddTutorial === stage.id ? (
                  <div className="rounded-xl border border-coral-500/30 bg-coral-50/50 p-4 dark:bg-coral-500/5">
                    <h4 className="mb-3 font-bold text-coral-700 dark:text-coral-300">Add New Tutorial</h4>
                    {editGrid(
                      <>
                        <div><Label>Title *</Label><Input placeholder="Tutorial title" value={newTut.title} onChange={e => setNewTut({ ...newTut, title: e.target.value })} /></div>
                        <div><Label>Module #</Label><Input placeholder="Module 1.4" value={newTut.module_number} onChange={e => setNewTut({ ...newTut, module_number: e.target.value })} /></div>
                        <div><Label>YouTube URL *</Label><Input placeholder="https://youtube.com/watch?v=..." value={newTut.youtube_url} onChange={e => setNewTut({ ...newTut, youtube_url: e.target.value })} /></div>
                        <div><Label>Duration (min)</Label><Input type="number" value={newTut.duration_minutes} onChange={e => setNewTut({ ...newTut, duration_minutes: parseInt(e.target.value) || 0 })} /></div>
                        <div><Label>Start (seconds)</Label><Input type="number" value={newTut.start_seconds} onChange={e => setNewTut({ ...newTut, start_seconds: parseInt(e.target.value) || 0 })} /></div>
                        <div><Label>End (seconds)</Label><Input type="number" value={newTut.end_seconds} onChange={e => setNewTut({ ...newTut, end_seconds: parseInt(e.target.value) || 0 })} /></div>
                      </>,
                    )}
                    <div className="mt-3">
                      <Label>Description</Label>
                      <textarea
                        className={cn(inputClasses(), 'resize-y')}
                        rows={2}
                        placeholder="Brief description..."
                        value={newTut.description}
                        onChange={e => setNewTut({ ...newTut, description: e.target.value })}
                      />
                    </div>
                    {newTut.youtube_url && extractYouTubeId(newTut.youtube_url || '') && (
                      <div className="mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          iconLeft={<Play className="size-3.5" />}
                          onClick={() => openPreview(newTut.youtube_url || '', newTut.start_seconds || 0, newTut.end_seconds || 120)}
                        >
                          Preview Clip
                        </Button>
                      </div>
                    )}
                    <div className="mt-4 flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setShowAddTutorial(null)}>
                        Cancel
                      </Button>
                      <Button iconLeft={<Save className="size-4" />} onClick={() => addTutorial(stage.id)} disabled={!newTut.title?.trim()}>
                        Add Tutorial
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/60 py-3 text-sm font-semibold text-ink-muted hover:border-coral-500 hover:text-coral-600 cursor-pointer dark:hover:text-coral-300"
                    onClick={() => setShowAddTutorial(stage.id)}
                  >
                    <Plus className="size-4" /> Add Tutorial to this Stage
                  </button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Add stage modal */}
      <Modal
        open={showAddStage}
        onClose={() => setShowAddStage(false)}
        title="Add New Training Stage"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddStage(false)}>
              Cancel
            </Button>
            <Button iconLeft={<Layers className="size-4" />} onClick={addStage} disabled={!newStageTitle.trim()}>
              Create Stage
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <Label>Stage Title *</Label>
            <Input
              placeholder="e.g. Advanced Field Operations"
              value={newStageTitle}
              onChange={e => setNewStageTitle(e.target.value)}
            />
          </div>
          <div>
            <Label>Description</Label>
            <textarea
              className={cn(inputClasses(), 'resize-y')}
              rows={3}
              placeholder="What learners will cover..."
              value={newStageDesc}
              onChange={e => setNewStageDesc(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminTutorialsPage;
