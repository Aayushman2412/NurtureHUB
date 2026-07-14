import React, { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import client from '../../api/client';
import {
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  Video,
  Play,
  Layers,
  HelpCircle,
  ToggleLeft,
  ToggleRight,
  FileText,
} from 'lucide-react';
import { Button, Card, FieldLabel, Input, Modal, PageHeader, PageLoader, Select } from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import { cn } from '../../utils/cn';

interface Tutorial {
  id: number;
  title: string;
  description: string;
  module_number: string;
  duration_minutes: number;
  video_url: string;
  youtube_url: string;
  start_seconds: number;
  end_seconds: number;
  order_index: number;
  quiz_enabled: boolean;
  quiz_question_count: number;
}

interface Stage {
  id: number;
  title: string;
  description: string;
  order_index: number;
  stage_type: 'tutorials' | 'test';
  quiz_enabled: boolean;
  tutorials: Tutorial[];
}

interface QuizQuestionForm {
  text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
}

const emptyQuestion = (): QuizQuestionForm => ({
  text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_answer: 'A',
});

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
  const { t } = useTranslation('adminTutorials');
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [editingTutorial, setEditingTutorial] = useState<number | null>(null);
  const [showAddStage, setShowAddStage] = useState(false);
  const [showAddTutorial, setShowAddTutorial] = useState<number | null>(null);
  const [previewVideoId, setPreviewVideoId] = useState<string>('');
  const [previewStart, setPreviewStart] = useState(0);
  const [previewEnd, setPreviewEnd] = useState(0);

  // New stage form (this screen only creates VIDEO phases; test phases live in Test Management)
  const [newStageTitle, setNewStageTitle] = useState('');
  const [newStageDesc, setNewStageDesc] = useState('');

  const [newTut, setNewTut] = useState<Partial<Tutorial>>({
    title: '',
    description: '',
    module_number: '',
    duration_minutes: 5,
    video_url: '',
    youtube_url: '',
    start_seconds: 0,
    end_seconds: 120,
  });

  // Quiz editor modal state
  const [quizTutorial, setQuizTutorial] = useState<Tutorial | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionForm[]>([]);
  const [quizSaving, setQuizSaving] = useState(false);

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
      .post(`/api/admin/stages?district=${getDistrict()}`, {
        title: newStageTitle,
        description: newStageDesc,
        stage_type: 'tutorials',
      })
      .then(() => {
        fetchStages();
        setShowAddStage(false);
        setNewStageTitle('');
        setNewStageDesc('');
      });
  };

  const deleteStage = (id: number) => {
    if (!confirm(t('stage.confirmDelete'))) return;
    client.delete(`/api/admin/stages/${id}?district=${getDistrict()}`).then(fetchStages);
  };

  const toggleStageQuiz = (stage: Stage) => {
    client
      .put(`/api/admin/stages/${stage.id}/quiz-enabled?district=${getDistrict()}`, {
        enabled: !stage.quiz_enabled,
        apply_to_tutorials: true,
      })
      .then(fetchStages);
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
        video_url: '',
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
    if (!confirm(t('tutorial.confirmDelete'))) return;
    client.delete(`/api/admin/tutorials/${id}?district=${getDistrict()}`).then(fetchStages);
  };

  const toggleTutorialQuiz = (tut: Tutorial) => {
    client
      .put(`/api/admin/tutorials/${tut.id}/quiz-enabled?district=${getDistrict()}`, {
        enabled: !tut.quiz_enabled,
      })
      .then(fetchStages);
  };

  const openQuizEditor = async (tut: Tutorial) => {
    try {
      const res = await client.get(`/api/admin/tutorials/${tut.id}/quiz-questions`);
      const questions: QuizQuestionForm[] = (res.data.questions || []).map((q: QuizQuestionForm) => ({
        text: q.text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        correct_answer: q.correct_answer,
      }));
      setQuizQuestions(questions.length > 0 ? questions : [emptyQuestion()]);
      setQuizTutorial(tut);
    } catch {
      // ignore; keep page usable
    }
  };

  const saveQuiz = async () => {
    if (!quizTutorial) return;
    setQuizSaving(true);
    try {
      const valid = quizQuestions.filter(q => q.text.trim() && q.option_a.trim() && q.option_b.trim());
      await client.put(`/api/admin/tutorials/${quizTutorial.id}/quiz-questions`, { questions: valid });
      setQuizTutorial(null);
      fetchStages();
    } finally {
      setQuizSaving(false);
    }
  };

  const openPreview = (url: string, start: number, end: number) => {
    const videoId = extractYouTubeId(url);
    if (videoId) {
      setPreviewVideoId(videoId);
      setPreviewStart(start);
      setPreviewEnd(end);
    }
  };

  if (loading) return <PageLoader label={t('loading')} />;

  const iconBtn =
    'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer';
  const dangerIconBtn =
    'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10';

  const editGrid = (fields: React.ReactNode) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields}</div>
  );

  return (
    <div>
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
        actions={
          <Button iconLeft={<Layers className="size-4" />} onClick={() => setShowAddStage(true)}>
            {t('header.addPhase')}
          </Button>
        }
      />

      {/* Video preview */}
      {previewVideoId && (
        <Card className="mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display font-bold text-ink">
              <Play className="size-4 text-coral-600 dark:text-coral-300" /> {t('preview.title')}
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
            {t('preview.clip', {
              start: formatTime(previewStart),
              end: formatTime(previewEnd),
              duration: formatTime(previewEnd - previewStart),
            })}
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
                <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-coral-600 dark:text-coral-300">
                  {stage.stage_type === 'test' && <FileText className="size-3" />}
                  {t('stage.phaseLabel', { n: stage.order_index + 1 })}
                  {stage.stage_type === 'test' ? t('stage.testPhaseSuffix') : ''}
                </span>
                <h3 className="mt-0.5 font-display text-lg font-bold text-ink">{stage.title}</h3>
                <p className="text-sm text-ink-muted">{stage.description}</p>
                <span className="text-xs text-ink-faint">
                  {stage.stage_type === 'test'
                    ? t('stage.testSummary')
                    : t('stage.summary', {
                        n: stage.tutorials.length,
                        status: stage.quiz_enabled ? t('stage.quizEnabled') : t('stage.quizDisabled'),
                      })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {stage.stage_type !== 'test' && (
                  <span
                    role="button"
                    tabIndex={0}
                    className={cn(
                      iconBtn,
                      stage.quiz_enabled ? 'text-success-600 dark:text-success-400' : 'text-ink-muted',
                    )}
                    onClick={e => {
                      e.stopPropagation();
                      toggleStageQuiz(stage);
                    }}
                    title={stage.quiz_enabled ? t('stage.toggleQuizDisable') : t('stage.toggleQuizEnable')}
                  >
                    {stage.quiz_enabled ? <ToggleRight className="size-5" /> : <ToggleLeft className="size-5" />}
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  className={dangerIconBtn}
                  onClick={e => {
                    e.stopPropagation();
                    deleteStage(stage.id);
                  }}
                  title={t('stage.deletePhase')}
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
                          {t('tutorial.meta', { module: tut.module_number, minutes: tut.duration_minutes })}
                          {tut.youtube_url
                            ? t('tutorial.clipSuffix', {
                                start: formatTime(tut.start_seconds),
                                end: formatTime(tut.end_seconds),
                              })
                            : tut.video_url
                              ? t('tutorial.mp4Suffix')
                              : ''}
                          {' • '}
                          <span
                            className={cn(
                              tut.quiz_enabled && tut.quiz_question_count > 0
                                ? 'text-success-600 dark:text-success-400'
                                : 'text-ink-faint',
                            )}
                          >
                            {t('tutorial.quizLabel')}
                            {tut.quiz_question_count > 0
                              ? t('tutorial.quizCount', { n: tut.quiz_question_count })
                              : t('tutorial.quizNone')}
                            {tut.quiz_enabled ? '' : t('tutorial.quizOff')}
                          </span>
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className={cn(
                            iconBtn,
                            tut.quiz_enabled ? 'text-success-600 dark:text-success-400' : 'text-ink-muted',
                          )}
                          onClick={() => toggleTutorialQuiz(tut)}
                          title={tut.quiz_enabled ? t('tutorial.toggleQuizDisable') : t('tutorial.toggleQuizEnable')}
                        >
                          {tut.quiz_enabled ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
                        </button>
                        <button className={iconBtn} onClick={() => openQuizEditor(tut)} title={t('tutorial.manageQuiz')}>
                          <HelpCircle className="size-3.5" />
                        </button>
                        {tut.youtube_url && (
                          <button
                            className={iconBtn}
                            onClick={() => openPreview(tut.youtube_url, tut.start_seconds, tut.end_seconds)}
                            title={t('tutorial.preview')}
                          >
                            <Play className="size-3.5" />
                          </button>
                        )}
                        <button
                          className={iconBtn}
                          onClick={() => setEditingTutorial(editingTutorial === tut.id ? null : tut.id)}
                          title={t('tutorial.edit')}
                        >
                          <Edit3 className="size-3.5" />
                        </button>
                        <button className={dangerIconBtn} onClick={() => deleteTutorial(tut.id)} title={t('tutorial.delete')}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    {editingTutorial === tut.id && (
                      <div className="mt-4 border-t border-border pt-4">
                        {editGrid(
                          <>
                            <div>
                              <FieldLabel size="sm">{t('fields.title')}</FieldLabel>
                              <Input value={tut.title} onChange={e => updateTutorial(tut.id, { title: e.target.value })} />
                            </div>
                            <div>
                              <FieldLabel size="sm">{t('fields.moduleNumber')}</FieldLabel>
                              <Input
                                value={tut.module_number}
                                onChange={e => updateTutorial(tut.id, { module_number: e.target.value })}
                              />
                            </div>
                            <div>
                              <FieldLabel size="sm">{t('fields.youtubeUrl')}</FieldLabel>
                              <Input
                                value={tut.youtube_url}
                                onChange={e => updateTutorial(tut.id, { youtube_url: e.target.value })}
                              />
                            </div>
                            <div>
                              <FieldLabel size="sm">{t('fields.videoFileUrl')}</FieldLabel>
                              <Input
                                value={tut.video_url}
                                onChange={e => updateTutorial(tut.id, { video_url: e.target.value })}
                              />
                            </div>
                            <div>
                              <FieldLabel size="sm">{t('fields.durationMin')}</FieldLabel>
                              <Input
                                type="number"
                                value={tut.duration_minutes}
                                onChange={e => updateTutorial(tut.id, { duration_minutes: parseInt(e.target.value) || 0 })}
                              />
                            </div>
                            <div>
                              <FieldLabel size="sm">{t('fields.startSeconds')}</FieldLabel>
                              <Input
                                type="number"
                                value={tut.start_seconds}
                                onChange={e => updateTutorial(tut.id, { start_seconds: parseInt(e.target.value) || 0 })}
                              />
                            </div>
                            <div>
                              <FieldLabel size="sm">{t('fields.endSeconds')}</FieldLabel>
                              <Input
                                type="number"
                                value={tut.end_seconds}
                                onChange={e => updateTutorial(tut.id, { end_seconds: parseInt(e.target.value) || 0 })}
                              />
                            </div>
                          </>,
                        )}
                        <div className="mt-3">
                          <FieldLabel size="sm">{t('fields.description')}</FieldLabel>
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
                    <h4 className="mb-3 font-bold text-coral-700 dark:text-coral-300">{t('addTutorial.heading')}</h4>
                    {editGrid(
                      <>
                        <div>
                          <FieldLabel size="sm">{t('fields.titleRequired')}</FieldLabel>
                          <Input
                            placeholder={t('placeholders.title')}
                            value={newTut.title}
                            onChange={e => setNewTut({ ...newTut, title: e.target.value })}
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('fields.moduleNumber')}</FieldLabel>
                          <Input
                            placeholder={t('placeholders.moduleNumber')}
                            value={newTut.module_number}
                            onChange={e => setNewTut({ ...newTut, module_number: e.target.value })}
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('fields.youtubeUrl')}</FieldLabel>
                          <Input
                            placeholder={t('placeholders.youtubeUrl')}
                            value={newTut.youtube_url}
                            onChange={e => setNewTut({ ...newTut, youtube_url: e.target.value })}
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('fields.videoFileUrl')}</FieldLabel>
                          <Input
                            placeholder={t('placeholders.videoFileUrl')}
                            value={newTut.video_url}
                            onChange={e => setNewTut({ ...newTut, video_url: e.target.value })}
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('fields.durationMin')}</FieldLabel>
                          <Input
                            type="number"
                            value={newTut.duration_minutes}
                            onChange={e => setNewTut({ ...newTut, duration_minutes: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('fields.startSeconds')}</FieldLabel>
                          <Input
                            type="number"
                            value={newTut.start_seconds}
                            onChange={e => setNewTut({ ...newTut, start_seconds: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('fields.endSeconds')}</FieldLabel>
                          <Input
                            type="number"
                            value={newTut.end_seconds}
                            onChange={e => setNewTut({ ...newTut, end_seconds: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      </>,
                    )}
                    <div className="mt-3">
                      <FieldLabel size="sm">{t('fields.description')}</FieldLabel>
                      <textarea
                        className={cn(inputClasses(), 'resize-y')}
                        rows={2}
                        placeholder={t('placeholders.description')}
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
                          onClick={() =>
                            openPreview(newTut.youtube_url || '', newTut.start_seconds || 0, newTut.end_seconds || 120)
                          }
                        >
                          {t('addTutorial.previewClip')}
                        </Button>
                      </div>
                    )}
                    <div className="mt-4 flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setShowAddTutorial(null)}>
                        {t('addTutorial.cancel')}
                      </Button>
                      <Button
                        iconLeft={<Save className="size-4" />}
                        onClick={() => addTutorial(stage.id)}
                        disabled={!newTut.title?.trim()}
                      >
                        {t('addTutorial.submit')}
                      </Button>
                    </div>
                  </div>
                ) : stage.stage_type !== 'test' ? (
                  <button
                    className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/60 py-3 text-sm font-semibold text-ink-muted hover:border-coral-500 hover:text-coral-600 cursor-pointer dark:hover:text-coral-300"
                    onClick={() => setShowAddTutorial(stage.id)}
                  >
                    <Plus className="size-4" /> {t('tutorial.addToPhase')}
                  </button>
                ) : (
                  <p className="my-2 text-sm text-ink-faint">
                    <Trans
                      t={t}
                      i18nKey="stage.testPhaseNote"
                      components={{ strong: <strong className="text-ink-muted" /> }}
                    />
                  </p>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Add phase modal */}
      <Modal
        open={showAddStage}
        onClose={() => setShowAddStage(false)}
        title={t('addPhaseModal.title')}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddStage(false)}>
              {t('addPhaseModal.cancel')}
            </Button>
            <Button iconLeft={<Layers className="size-4" />} onClick={addStage} disabled={!newStageTitle.trim()}>
              {t('addPhaseModal.create')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <FieldLabel size="sm">{t('addPhaseModal.phaseTitleLabel')}</FieldLabel>
            <Input
              placeholder={t('placeholders.phaseTitle')}
              value={newStageTitle}
              onChange={e => setNewStageTitle(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel size="sm">{t('fields.description')}</FieldLabel>
            <textarea
              className={cn(inputClasses(), 'resize-y')}
              rows={3}
              placeholder={t('placeholders.phaseDescription')}
              value={newStageDesc}
              onChange={e => setNewStageDesc(e.target.value)}
            />
          </div>
          <p className="text-[13px] text-ink-faint">
            <Trans t={t} i18nKey="addPhaseModal.note" components={{ strong: <strong className="text-ink-muted" /> }} />
          </p>
        </div>
      </Modal>

      {/* Quiz editor modal */}
      <Modal
        open={!!quizTutorial}
        onClose={() => setQuizTutorial(null)}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            <HelpCircle className="size-4" /> {t('quiz.modalTitle', { title: quizTutorial?.title ?? '' })}
          </span>
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setQuizTutorial(null)}>
              {t('quiz.cancel')}
            </Button>
            <Button iconLeft={<Save className="size-4" />} onClick={saveQuiz} loading={quizSaving} disabled={quizSaving}>
              {quizSaving ? t('quiz.saving') : t('quiz.save')}
            </Button>
          </>
        }
      >
        <p className="mt-0 text-[13px] text-ink-muted">{t('quiz.intro')}</p>
        {quizQuestions.map((q, qi) => (
          <div key={qi} className="mt-4 rounded-xl border border-border p-4">
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-sm text-ink">{t('quiz.questionLabel', { n: qi + 1 })}</strong>
              <button
                className={dangerIconBtn}
                onClick={() => setQuizQuestions(qs => qs.filter((_, i) => i !== qi))}
                title={t('quiz.removeQuestion')}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <Input
              placeholder={t('placeholders.questionText')}
              value={q.text}
              onChange={e => setQuizQuestions(qs => qs.map((qq, i) => (i === qi ? { ...qq, text: e.target.value } : qq)))}
            />
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['a', 'b', 'c', 'd'] as const).map(letter => (
                <div key={letter}>
                  <FieldLabel size="sm">
                    {t('quiz.optionLabel', { letter: letter.toUpperCase() })}
                    {letter === 'a' || letter === 'b' ? ' *' : ''}
                  </FieldLabel>
                  <Input
                    value={q[`option_${letter}` as keyof QuizQuestionForm] as string}
                    onChange={e =>
                      setQuizQuestions(qs =>
                        qs.map((qq, i) => (i === qi ? { ...qq, [`option_${letter}`]: e.target.value } : qq)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 max-w-[200px]">
              <FieldLabel size="sm">{t('quiz.correctAnswer')}</FieldLabel>
              <Select
                value={q.correct_answer}
                onChange={e =>
                  setQuizQuestions(qs => qs.map((qq, i) => (i === qi ? { ...qq, correct_answer: e.target.value } : qq)))
                }
              >
                {['A', 'B', 'C', 'D'].map(l => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ))}
        <button
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/60 py-3 text-sm font-semibold text-ink-muted hover:border-coral-500 hover:text-coral-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-coral-300"
          onClick={() => setQuizQuestions(qs => [...qs, emptyQuestion()])}
          disabled={quizQuestions.length >= 5}
        >
          <Plus className="size-4" /> {t('quiz.addQuestion')} {quizQuestions.length >= 5 ? t('quiz.maxSuffix') : ''}
        </button>
      </Modal>
    </div>
  );
};

export default AdminTutorialsPage;
