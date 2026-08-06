import client from './client';

/** Admin "Database" section — data-analytics pipelines API (/api/admin/pipelines). */

export interface PipelineProject {
  code: string;
  name: string;
}

export interface PipelineOverview {
  crosstabs: { projects: PipelineProject[] };
  masd: { kinds: { kind: string; label: string }[] };
}

/** 'reference' = fixed master sheets every run needs (restored from the
 *  built-in copy if deleted); 'dated' = the data that changes each run. */
export type InputGroup = 'reference' | 'dated';

export interface InputFile {
  group: InputGroup;
  /** Which upload slot this file belongs to (see InputKind.key). */
  kind: string;
  /** Date token carried by the filename/folder, when there is one. */
  date: string | null;
  path: string;
  name: string;
  size: number;
  modified: string;
}

/** One upload slot — a distinct thing the pipeline consumes. */
export interface InputKind {
  key: string;
  group: InputGroup;
  required: boolean;
  label: string;
  description: string;
  accept: string;
  multiple: boolean;
  allows_zip: boolean;
  hint: string;
}

export interface RawFolder {
  name: string;
  csv_count: number;
  dated: boolean;
}

export interface CrosstabsInputStatus {
  raw_folders: RawFolder[];
  loose_csv_count: number;
  role_sheet: boolean;
  masd_combined: string[];
  raw_masd: string[];
  docs_fill: string[];
  problems: string[];
  warnings: string[];
}

export interface MasdProjectPresence {
  prefix: string;
  project: string;
  present: boolean;
  files: string[];
}

export interface MasdInputStatus {
  projects: MasdProjectPresence[];
  unrecognized: string[];
  masters_missing: string[];
  problems: string[];
}

export interface ManifestEntry {
  path: string;
  name: string;
  size: number;
  section: string;
}

export interface PipelineRun {
  id: number;
  pipeline: string;
  variant: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'imported';
  label: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  report: Record<string, unknown>;
  file_count: number;
  manifest?: ManifestEntry[];
  sections?: string[];
}

export interface ScriptVersion {
  version: number;
  original_name: string;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string | null;
}

export interface ScriptSlot {
  slot: string;
  label: string;
  canonical: string | null;
  multi: boolean;
  versions: ScriptVersion[];
  active_version: number | null;
}

export type PipelineKey = 'crosstabs' | 'masd';

// ------------------------------------------------------------------ overview

export const getPipelineOverview = (): Promise<PipelineOverview> =>
  client.get('/api/admin/pipelines/overview').then(r => r.data);

// -------------------------------------------------------------------- inputs

export const getCrosstabsInputs = (
  project: string,
): Promise<{
  files: InputFile[]; kinds: InputKind[];
  status: CrosstabsInputStatus; default_raw_subdir: string;
}> =>
  client.get(`/api/admin/pipelines/crosstabs/${project}/inputs`).then(r => r.data);

export const getMasdInputs = (): Promise<{
  files: InputFile[]; kinds: InputKind[]; status: MasdInputStatus;
}> =>
  client.get('/api/admin/pipelines/masd/inputs').then(r => r.data);

const inputsUrl = (pipeline: PipelineKey, project?: string) =>
  pipeline === 'crosstabs'
    ? `/api/admin/pipelines/crosstabs/${project}/inputs`
    : '/api/admin/pipelines/masd/inputs';

export const uploadPipelineInputs = (
  pipeline: PipelineKey,
  project: string | undefined,
  files: File[],
  subdir?: string,
  kind?: string,
): Promise<{ saved: { path: string; size: number }[] }> => {
  const data = new FormData();
  files.forEach(f => data.append('files', f));
  if (subdir) data.append('subdir', subdir);
  if (kind) data.append('kind', kind);
  return client
    .post(inputsUrl(pipeline, project), data, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then(r => r.data);
};

export const uploadPipelineInputsZip = (
  pipeline: PipelineKey,
  project: string | undefined,
  file: File,
  subdir?: string,
): Promise<{ extracted: string[] }> => {
  const data = new FormData();
  data.append('file', file);
  if (subdir) data.append('subdir', subdir);
  return client
    .post(`${inputsUrl(pipeline, project)}/zip`, data, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then(r => r.data);
};

export const deletePipelineInput = (
  pipeline: PipelineKey,
  project: string | undefined,
  path: string,
): Promise<void> =>
  client.delete(inputsUrl(pipeline, project), { params: { path } }).then(() => undefined);

/** Delete every input in one group, or all of them. */
export const deletePipelineInputGroup = (
  pipeline: PipelineKey,
  project: string | undefined,
  group: InputGroup | 'all',
): Promise<{ deleted: number }> =>
  client.delete(`${inputsUrl(pipeline, project)}/group/${group}`).then(r => r.data);

// ---------------------------------------------------------------------- runs

export const triggerCrosstabsRun = (project: string): Promise<PipelineRun> =>
  client.post(`/api/admin/pipelines/crosstabs/${project}/runs`).then(r => r.data);

export const triggerMasdRun = (kind: string): Promise<PipelineRun> =>
  client.post('/api/admin/pipelines/masd/runs', { kind }).then(r => r.data);

export const listPipelineRuns = (
  pipeline: PipelineKey,
  variant?: string,
): Promise<{ runs: PipelineRun[] }> =>
  client.get('/api/admin/pipelines/runs', { params: { pipeline, variant } }).then(r => r.data);

export const getPipelineRun = (runId: number): Promise<PipelineRun> =>
  client.get(`/api/admin/pipelines/runs/${runId}`).then(r => r.data);

export const getPipelineRunLog = (
  runId: number,
  file: 'console' | 'pipeline' | 'report' = 'console',
): Promise<string> =>
  client
    .get(`/api/admin/pipelines/runs/${runId}/log`, { params: { file }, responseType: 'text' })
    .then(r => r.data as string);

export const deletePipelineRun = (runId: number): Promise<void> =>
  client.delete(`/api/admin/pipelines/runs/${runId}`).then(() => undefined);

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadRunFile = async (runId: number, path: string): Promise<void> => {
  const res = await client.get(`/api/admin/pipelines/runs/${runId}/file`, {
    params: { path },
    responseType: 'blob',
  });
  const name = path.split('/').pop() || 'file';
  triggerBlobDownload(res.data as Blob, name);
};

export const downloadRunZip = async (
  runId: number,
  options: { paths?: string[]; section?: string },
  filename: string,
): Promise<void> => {
  const res = await client.post(`/api/admin/pipelines/runs/${runId}/zip`, options, {
    responseType: 'blob',
  });
  triggerBlobDownload(res.data as Blob, filename);
};

// ------------------------------------------------------------------- scripts

export const getPipelineScripts = (pipeline: PipelineKey): Promise<{ slots: ScriptSlot[] }> =>
  client.get(`/api/admin/pipelines/scripts/${pipeline}`).then(r => r.data);

export const uploadPipelineScript = (
  pipeline: PipelineKey,
  slot: string,
  file: File,
  notes?: string,
): Promise<{ slot: string; version: number }> => {
  const data = new FormData();
  data.append('file', file);
  if (notes) data.append('notes', notes);
  return client
    .post(`/api/admin/pipelines/scripts/${pipeline}/${slot}`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then(r => r.data);
};

export const activatePipelineScript = (
  pipeline: PipelineKey,
  slot: string,
  version: number | null,
): Promise<void> =>
  client
    .post(`/api/admin/pipelines/scripts/${pipeline}/${slot}/activate`, { version })
    .then(() => undefined);

export const deactivatePipelineScript = (
  pipeline: PipelineKey,
  slot: string,
  version: number,
): Promise<void> =>
  client
    .post(`/api/admin/pipelines/scripts/${pipeline}/${slot}/${version}/deactivate`)
    .then(() => undefined);

export const downloadPipelineScript = async (
  pipeline: PipelineKey,
  slot: string,
  version?: number,
  fallbackName?: string,
): Promise<void> => {
  const res = await client.get(`/api/admin/pipelines/scripts/${pipeline}/${slot}/file`, {
    params: version != null ? { version } : {},
    responseType: 'blob',
  });
  triggerBlobDownload(res.data as Blob, fallbackName || `${slot}-script`);
};

export const deletePipelineScript = (
  pipeline: PipelineKey,
  slot: string,
  version: number,
): Promise<void> =>
  client.delete(`/api/admin/pipelines/scripts/${pipeline}/${slot}/${version}`).then(() => undefined);
