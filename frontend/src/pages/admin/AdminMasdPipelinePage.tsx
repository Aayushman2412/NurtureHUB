import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2, FileCode2, FolderInput, PlayCircle, FileSpreadsheet, XCircle,
} from 'lucide-react';
import type { InputFile, InputGroup, InputKind, MasdInputStatus, ScriptSlot } from '../../api/pipelines';
import {
  deletePipelineInput, deletePipelineInputGroup, getMasdInputs, getPipelineScripts,
  triggerMasdRun, uploadPipelineInputs, uploadPipelineInputsZip,
} from '../../api/pipelines';
import { useToast } from '../../context/ToastContext';
import { Alert, Button, PageHeader, PageLoader, Tabs } from '../../components/ui';
import InputsPanel from '../../components/pipelines/InputsPanel';
import ScriptsPanel from '../../components/pipelines/ScriptsPanel';
import RunsPanel from '../../components/pipelines/RunsPanel';
import { usePipelineRuns } from '../../components/pipelines/usePipelineRuns';

type TabKey = 'runs' | 'inputs' | 'scripts';

/** Admin > Database > MASD Pipeline. Shared input pool — the scripts detect
 * which projects' CSVs are present and process exactly those. */
const AdminMasdPipelinePage: React.FC = () => {
  const { t } = useTranslation('pipelines');
  const { showToast } = useToast();

  const [tab, setTab] = useState<TabKey>('runs');
  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);
  const [inputKinds, setInputKinds] = useState<InputKind[]>([]);
  const [inputStatus, setInputStatus] = useState<MasdInputStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [slots, setSlots] = useState<ScriptSlot[]>([]);
  const [triggering, setTriggering] = useState<string | null>(null);

  const {
    runs, runsLoading, selectedRun, selectedLoading, selectRun, refresh,
  } = usePipelineRuns('masd');

  const loadInputs = useCallback(() => {
    getMasdInputs()
      .then(res => {
        setInputFiles(res.files);
        setInputKinds(res.kinds);
        setInputStatus(res.status);
      })
      .catch(() => {
        setInputFiles([]);
        setInputKinds([]);
        setInputStatus(null);
      });
  }, []);

  const loadScripts = useCallback(() => {
    getPipelineScripts('masd')
      .then(res => setSlots(res.slots))
      .catch(() => setSlots([]));
  }, []);

  useEffect(() => { loadInputs(); }, [loadInputs]);
  useEffect(() => { loadScripts(); }, [loadScripts]);

  const apiErrorDetail = (err: unknown): string | undefined =>
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  const handleUploadFiles = (files: File[], kind?: string) => {
    setUploading(true);
    uploadPipelineInputs('masd', undefined, files, undefined, kind)
      .then(res => {
        showToast(t('inputs.uploadedCount', { n: res.saved.length }), 'success');
        loadInputs();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.uploadFailed'), 'error'))
      .finally(() => setUploading(false));
  };

  const handleUploadZip = (file: File, kind?: string) => {
    setUploading(true);
    uploadPipelineInputsZip('masd', undefined, file)
      .then(res => {
        showToast(t('inputs.uploadedCount', { n: res.extracted.length }), 'success');
        loadInputs();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.uploadFailed'), 'error'))
      .finally(() => setUploading(false));
  };

  const handleDelete = (path: string) =>
    deletePipelineInput('masd', undefined, path)
      .then(() => loadInputs())
      .catch(err => showToast(apiErrorDetail(err) || t('errors.actionFailed'), 'error'));

  const handleDeleteGroup = (group: InputGroup | 'all') =>
    deletePipelineInputGroup('masd', undefined, group)
      .then(res => {
        showToast(t('inputs.deletedCount', { n: res.deleted }), 'success');
        loadInputs();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.actionFailed'), 'error'));

  const handleTrigger = (kind: 'combined' | 'raw_exclusion') => {
    setTriggering(kind);
    triggerMasdRun(kind)
      .then(run => {
        showToast(t('runs.started_toast', { id: run.id }), 'success');
        selectRun(run.id);
        refresh();
      })
      .catch(err => showToast(apiErrorDetail(err) || t('errors.actionFailed'), 'error'))
      .finally(() => setTriggering(null));
  };

  const problems = inputStatus?.problems || [];
  const kindLabels: Record<string, string> = {
    combined: t('masd.kindCombined'),
    raw_exclusion: t('masd.kindRawExclusion'),
  };

  const presenceBanner = inputStatus && (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {t('masd.detectedTitle')}
      </span>
      {inputStatus.projects.map(p => (
        <span
          key={p.prefix}
          className={
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ' +
            (p.present
              ? 'border-success-300 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400'
              : 'border-border bg-surface-sunken text-ink-faint')
          }
          title={p.files.join(', ')}
        >
          {p.present ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
          {p.project}
          {p.present && <span className="tabular-nums">({p.files.length})</span>}
        </span>
      ))}
      {inputStatus.unrecognized.length > 0 && (
        <span className="text-xs text-amber-600" title={inputStatus.unrecognized.join(', ')}>
          {t('masd.unrecognized', { n: inputStatus.unrecognized.length })}
        </span>
      )}
    </div>
  );

  const statusBanners = (
    <>
      {presenceBanner}
      {problems.length > 0 && (
        <Alert variant="error" title={t('inputs.problemsTitle')}>
          <ul className="list-inside list-disc space-y-0.5">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </Alert>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('masd.title')}
        description={t('masd.description')}
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
          variantLabels={kindLabels}
          triggerControls={
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-coral-50 dark:bg-coral-500/10">
                  <FileSpreadsheet className="size-4.5 text-primary-ink" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold text-ink">{t('masd.runTitle')}</div>
                  <div className="text-xs text-ink-muted">{t('masd.runHint')}</div>
                </div>
                <Button
                  variant="primary"
                  iconLeft={<PlayCircle className="size-4.5" />}
                  loading={triggering === 'combined'}
                  disabled={problems.length > 0 || triggering != null}
                  onClick={() => handleTrigger('combined')}
                >
                  {t('masd.runCombined')}
                </Button>
                <Button
                  variant="secondary"
                  iconLeft={<PlayCircle className="size-4.5" />}
                  loading={triggering === 'raw_exclusion'}
                  disabled={problems.length > 0 || triggering != null}
                  onClick={() => handleTrigger('raw_exclusion')}
                >
                  {t('masd.runRawExclusion')}
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
          extra={<div className="space-y-3">{statusBanners}</div>}
        />
      )}

      {tab === 'scripts' && (
        <ScriptsPanel pipeline="masd" slots={slots} onChanged={loadScripts} />
      )}
    </div>
  );
};

export default AdminMasdPipelinePage;
