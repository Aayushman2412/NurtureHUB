import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderInput, FileCode2, PlayCircle, Table2 } from 'lucide-react';
import type {
  CrosstabsInputStatus, InputFile, InputGroup, InputKind, PipelineProject, ScriptSlot,
} from '../../api/pipelines';
import {
  deletePipelineInput, deletePipelineInputGroup, getCrosstabsInputs, getPipelineOverview,
  getPipelineScripts, triggerCrosstabsRun, uploadPipelineInputs, uploadPipelineInputsZip,
} from '../../api/pipelines';
import { useToast } from '../../context/ToastContext';
import { Alert, Button, EmptyState, Field, Input, PageHeader, PageLoader, Tabs } from '../../components/ui';
import InputsPanel from '../../components/pipelines/InputsPanel';
import ScriptsPanel from '../../components/pipelines/ScriptsPanel';
import RunsPanel from '../../components/pipelines/RunsPanel';
import { usePipelineRuns } from '../../components/pipelines/usePipelineRuns';

type TabKey = 'runs' | 'inputs' | 'scripts';

/** Admin > Database > Crosstabs Pipeline. One project (district) at a time —
 * inputs, runs and outputs are fully isolated per project. */
const AdminCrosstabsPipelinePage: React.FC = () => {
  const { t } = useTranslation('pipelines');
  const { showToast } = useToast();

  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [project, setProject] = useState<string>('');
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<TabKey>('runs');

  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);
  const [inputKinds, setInputKinds] = useState<InputKind[]>([]);
  const [inputStatus, setInputStatus] = useState<CrosstabsInputStatus | null>(null);
  const [rawSubdir, setRawSubdir] = useState('');
  const [defaultSubdir, setDefaultSubdir] = useState('');
  const [uploading, setUploading] = useState(false);

  const [slots, setSlots] = useState<ScriptSlot[]>([]);
  const [triggering, setTriggering] = useState(false);

  const {
    runs, runsLoading, selectedRun, selectedLoading, selectRun, refresh,
  } = usePipelineRuns('crosstabs', project || undefined);

  useEffect(() => {
    getPipelineOverview()
      .then(res => {
        setProjects(res.crosstabs.projects);
        if (res.crosstabs.projects.length > 0) {
          setProject(prev => prev || res.crosstabs.projects[0].code);
        }
        setOverviewFailed(false);
      })
      .catch(() => {
        setProjects([]);
        setOverviewFailed(true);
      });
  }, [reloadKey]);

  // Guards every inputs response against the project it was requested for: a
  // slow response must not describe project A while project B is on screen
  // (its status gates the Run button).
  const projectRef = useRef(project);
  projectRef.current = project;

  const loadInputs = useCallback(() => {
    if (!project) return;
    const issuedFor = project;
    getCrosstabsInputs(project)
      .then(res => {
        if (projectRef.current !== issuedFor) return;
        setInputFiles(res.files);
        setInputKinds(res.kinds);
        setInputStatus(res.status);
        setDefaultSubdir(res.default_raw_subdir);
      })
      .catch(() => {
        if (projectRef.current !== issuedFor) return;
        setInputFiles([]);
        setInputKinds([]);
        setInputStatus(null);
      });
  }, [project]);

  const loadScripts = useCallback(() => {
    getPipelineScripts('crosstabs')
      .then(res => setSlots(res.slots))
      .catch(() => setSlots([]));
  }, []);

  useEffect(() => { loadInputs(); }, [loadInputs]);
  useEffect(() => { loadScripts(); }, [loadScripts]);
  useEffect(() => { setRawSubdir(''); }, [project]);

  const apiErrorDetail = (err: unknown): string | undefined =>
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  const handleUploadFiles = (files: File[], kind?: string) => {
    setUploading(true);
    uploadPipelineInputs('crosstabs', project, files, rawSubdir || undefined, kind)
      .then(res => {
        showToast(t('inputs.uploadedCount', { n: res.saved.length }), 'success');
        loadInputs();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.uploadFailed'), 'error'))
      .finally(() => setUploading(false));
  };

  // No `kind`: the zip endpoint extracts the archive's own paths and has no
  // per-kind parameter, unlike the plain-file upload above.
  const handleUploadZip = (file: File) => {
    setUploading(true);
    uploadPipelineInputsZip('crosstabs', project, file, rawSubdir || undefined)
      .then(res => {
        showToast(t('inputs.uploadedCount', { n: res.extracted.length }), 'success');
        loadInputs();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.uploadFailed'), 'error'))
      .finally(() => setUploading(false));
  };

  const handleDelete = (path: string) =>
    deletePipelineInput('crosstabs', project, path)
      .then(() => loadInputs())
      .catch(err => showToast(apiErrorDetail(err) || t('errors.actionFailed'), 'error'));

  const handleDeleteGroup = (group: InputGroup | 'all') =>
    deletePipelineInputGroup('crosstabs', project, group)
      .then(res => {
        showToast(t('inputs.deletedCount', { n: res.deleted }), 'success');
        loadInputs();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.actionFailed'), 'error'));

  const handleTrigger = () => {
    setTriggering(true);
    triggerCrosstabsRun(project)
      .then(run => {
        showToast(t('runs.started_toast', { id: run.id }), 'success');
        selectRun(run.id);
        refresh();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.actionFailed'), 'error'))
      .finally(() => setTriggering(false));
  };

  if (overviewFailed) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('crosstabs.title')} description={t('crosstabs.description')} />
        <EmptyState
          title={t('errors.loadFailedTitle')}
          description={t('errors.loadFailedDescription')}
          action={
            <Button variant="primary" onClick={() => setReloadKey(k => k + 1)}>
              {t('errors.retry')}
            </Button>
          }
        />
      </div>
    );
  }
  if (!project) return <PageLoader label={t('loading')} />;

  const problems = inputStatus?.problems || [];
  const warnings = inputStatus?.warnings || [];
  const projectName = projects.find(p => p.code === project)?.name || project;

  const statusBanners = (
    <>
      {problems.length > 0 && (
        <Alert variant="error" title={t('inputs.problemsTitle')}>
          <ul className="list-inside list-disc space-y-0.5">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning" title={t('inputs.warningsTitle')}>
          <ul className="list-inside list-disc space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Alert>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('crosstabs.title')}
        description={t('crosstabs.description')}
      />

      <Tabs
        value={project}
        onChange={value => setProject(value)}
        items={projects.map(p => ({ value: p.code, label: p.name }))}
      />

      <Tabs
        value={tab}
        onChange={value => setTab(value as TabKey)}
        items={[
          { value: 'runs', label: t('tabs.runs'), icon: <PlayCircle className="size-4" /> },
          { value: 'inputs', label: t('tabs.inputs'), icon: <FolderInput className="size-4" /> },
          { value: 'scripts', label: t('tabs.scripts'), icon: <FileCode2 className="size-4" /> },
        ]}
      />

      {tab === 'runs' && (runsLoading ? <PageLoader label={t('loading')} /> : (
        <RunsPanel
          runs={runs}
          selectedRun={selectedRun}
          selectedLoading={selectedLoading}
          onSelect={selectRun}
          onChanged={refresh}
          triggerControls={
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-coral-50 dark:bg-coral-500/10">
                  <Table2 className="size-4.5 text-primary-ink" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold text-ink">
                    {t('crosstabs.runTitle', { project: projectName })}
                  </div>
                  <div className="text-xs text-ink-muted">{t('crosstabs.runHint')}</div>
                </div>
                <Button
                  variant="primary"
                  iconLeft={<PlayCircle className="size-4.5" />}
                  loading={triggering}
                  disabled={problems.length > 0}
                  onClick={handleTrigger}
                >
                  {t('crosstabs.runButton')}
                </Button>
              </div>
              {statusBanners}
            </div>
          }
        />
      ))}

      {tab === 'inputs' && (
        <InputsPanel
          files={inputFiles}
          kinds={inputKinds}
          uploading={uploading}
          onUploadFiles={handleUploadFiles}
          onUploadZip={handleUploadZip}
          onDelete={handleDelete}
          onDeleteGroup={handleDeleteGroup}
          slotExtras={{
            raw_folder: (
              <Field
                label={t('crosstabs.rawFolderLabel')}
                htmlFor="raw-subdir"
              >
                <Input
                  id="raw-subdir"
                  value={rawSubdir}
                  onChange={e => setRawSubdir(e.target.value)}
                  placeholder={defaultSubdir}
                />
                <p className="mt-1 text-xs text-ink-muted">{t('crosstabs.rawFolderHint')}</p>
              </Field>
            ),
          }}
          extra={
            <div className="space-y-3">
              {statusBanners}
            </div>
          }
        />
      )}

      {tab === 'scripts' && (
        <div className="space-y-3">
          <Alert variant="info">{t('crosstabs.scriptsShared')}</Alert>
          <ScriptsPanel pipeline="crosstabs" slots={slots} onChanged={loadScripts} />
        </div>
      )}
    </div>
  );
};

export default AdminCrosstabsPipelinePage;
