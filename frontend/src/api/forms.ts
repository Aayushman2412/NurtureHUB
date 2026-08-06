/**
 * API wrappers for the dynamic form system (admin builder + learner assessments).
 */

import client from './client';
import type {
  AnswerIn,
  FlatSchema,
  FlowSchema,
  FormDefinition,
  FormDefinitionSummary,
  FormKey,
  FormResponseDetail,
  FormResponseListItem,
} from '../lib/flowTypes';

// ── Admin ────────────────────────────────────────────────────────────────────

export const adminListForms = (): Promise<FormDefinitionSummary[]> =>
  client.get('/api/admin/forms').then(r => r.data);

export const adminGetForm = (formKey: FormKey): Promise<FormDefinition> =>
  client.get(`/api/admin/forms/${formKey}`).then(r => r.data);

export const adminSaveForm = (
  formKey: FormKey,
  payload: { title?: string; description?: string; schema_json: FlowSchema | FlatSchema },
): Promise<FormDefinition> =>
  client.put(`/api/admin/forms/${formKey}`, payload).then(r => r.data);

/**
 * Download a form as a template zip: form.json (re-importable definition),
 * media-manifest.csv (every image/video link + where it's used) and assets/
 * with copies of the referenced uploads. Triggers the browser download.
 */
export const adminExportForm = async (formKey: FormKey, version?: number): Promise<void> => {
  const res = await client.get(`/api/admin/forms/${formKey}/export`, {
    responseType: 'blob',
    // With a version, the backend exports THAT history version's schema.
    params: version ? { version } : undefined,
  });
  const url = URL.createObjectURL(res.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${formKey}-template${version ? `-v${version}` : ''}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/** Upload an image/GIF/video asset; returns a backend-relative `/uploads/...` URL. */
export const adminUploadFormAsset = (file: File): Promise<{ url: string }> => {
  const data = new FormData();
  data.append('file', file);
  return client
    .post('/api/admin/forms/assets', data, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then(r => r.data);
};

// ── Admin: form versions (git-style history + district pinning) ──────────────

export interface FormVersionDistrict {
  id: number;
  name: string;
  slug: string;
}

export interface FormVersionSummary {
  id: number;
  form_key: string;
  version_number: number;
  /** Admin-entered "commit" date (ISO date). */
  created_on: string | null;
  description: string;
  /** What the builder detected changed vs the version this one was edited from. */
  detected_changes: string[];
  /** The version number that diff was taken against (null for pre-diff rows). */
  diffed_from_version: number | null;
  created_by: string | null;
  created_at: string | null;
  is_default: boolean;
  /** Assessments filed against this version (null when not computed). */
  response_count: number | null;
  districts: FormVersionDistrict[];
}

export interface FormVersionDetail extends FormVersionSummary {
  schema_json: FlowSchema | FlatSchema;
  builder_type: 'flow' | 'flat';
  title: string;
}

export interface FormVersionsList {
  form_key: string;
  title: string;
  builder_type: 'flow' | 'flat';
  description: string | null;
  versions: FormVersionSummary[];
}

export const adminListFormVersions = (formKey: FormKey): Promise<FormVersionsList> =>
  client.get(`/api/admin/forms/${formKey}/versions`).then(r => r.data);

export const adminGetFormVersion = (formKey: FormKey, versionNumber: number): Promise<FormVersionDetail> =>
  client.get(`/api/admin/forms/${formKey}/versions/${versionNumber}`).then(r => r.data);

export const adminCreateFormVersion = (
  formKey: FormKey,
  payload: {
    schema_json: FlowSchema | FlatSchema;
    created_on: string;       // ISO date, admin-entered
    description: string;      // change summary ("first creation" for v1)
    make_default?: boolean;
    title?: string;
    /** Form-level description shown to learners (applied on default saves). */
    definition_description?: string;
    /** Auto-detected diff recorded alongside the admin's description. */
    detected_changes?: string[];
    /** The version number that diff was taken against. */
    diffed_from_version?: number;
  },
): Promise<FormVersionDetail> =>
  client.post(`/api/admin/forms/${formKey}/versions`, payload).then(r => r.data);

export const adminSetVersionDistricts = (
  formKey: FormKey,
  versionNumber: number,
  districtIds: number[],
): Promise<FormVersionSummary> =>
  client
    .put(`/api/admin/forms/${formKey}/versions/${versionNumber}/districts`, { district_ids: districtIds })
    .then(r => r.data);

export const adminMakeVersionDefault = (
  formKey: FormKey,
  versionNumber: number,
): Promise<FormVersionSummary> =>
  client.post(`/api/admin/forms/${formKey}/versions/${versionNumber}/make-default`).then(r => r.data);

/**
 * Delete one version. Rejected by the server for the default version and for
 * the last remaining one; returns the projects that lost their pin and now
 * follow the default.
 */
export const adminDeleteFormVersion = (
  formKey: FormKey,
  versionNumber: number,
): Promise<{ deleted_version: number; unpinned_districts: string[] }> =>
  client.delete(`/api/admin/forms/${formKey}/versions/${versionNumber}`).then(r => r.data);

// ── Learner ──────────────────────────────────────────────────────────────────

export const getFormDefinition = (formKey: FormKey): Promise<FormDefinition> =>
  client.get(`/api/forms/${formKey}`).then(r => r.data);

/** Upload a photo answer (flat `image` fields); returns a backend-relative `/uploads/...` URL. */
export const uploadLearnerMedia = (file: File): Promise<{ url: string }> => {
  const data = new FormData();
  data.append('file', file);
  return client
    .post('/api/forms/uploads', data, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then(r => r.data);
};

export const listChildResponses = (
  formKey: FormKey,
  childId: number,
): Promise<FormResponseListItem[]> =>
  client
    .get(`/api/forms/${formKey}/responses`, { params: { child_id: childId } })
    .then(r => r.data);

/** List responses of a MOTHER-level form (e.g. protein intake) for one mother. */
export const listMotherResponses = (
  formKey: FormKey,
  motherId: number,
): Promise<FormResponseListItem[]> =>
  client
    .get(`/api/forms/${formKey}/responses`, { params: { mother_id: motherId } })
    .then(r => r.data);

export interface ResponsePayload {
  /** Exactly one of child_id / mother_id, matching the form's level. */
  child_id?: number;
  mother_id?: number;
  assessment_date: string; // ISO date
  status: 'draft' | 'submitted';
  answers: AnswerIn[];
}

export const createResponse = (
  formKey: FormKey,
  payload: ResponsePayload,
): Promise<FormResponseDetail> =>
  client.post(`/api/forms/${formKey}/responses`, payload).then(r => r.data);

export const updateResponse = (
  responseId: number,
  payload: Omit<ResponsePayload, 'child_id' | 'mother_id'>,
): Promise<FormResponseDetail> =>
  client.put(`/api/forms/responses/${responseId}`, payload).then(r => r.data);

export const getResponse = (responseId: number): Promise<FormResponseDetail> =>
  client.get(`/api/forms/responses/${responseId}`).then(r => r.data);

export const deleteResponse = (responseId: number): Promise<void> =>
  client.delete(`/api/forms/responses/${responseId}`).then(() => undefined);
