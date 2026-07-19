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

/** Upload an image/GIF/video asset; returns a backend-relative `/uploads/...` URL. */
export const adminUploadFormAsset = (file: File): Promise<{ url: string }> => {
  const data = new FormData();
  data.append('file', file);
  return client
    .post('/api/admin/forms/assets', data, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then(r => r.data);
};

// ── Learner ──────────────────────────────────────────────────────────────────

export const getFormDefinition = (formKey: FormKey): Promise<FormDefinition> =>
  client.get(`/api/forms/${formKey}`).then(r => r.data);

export const listChildResponses = (
  formKey: FormKey,
  childId: number,
): Promise<FormResponseListItem[]> =>
  client
    .get(`/api/forms/${formKey}/responses`, { params: { child_id: childId } })
    .then(r => r.data);

export interface ResponsePayload {
  child_id: number;
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
  payload: Omit<ResponsePayload, 'child_id'>,
): Promise<FormResponseDetail> =>
  client.put(`/api/forms/responses/${responseId}`, payload).then(r => r.data);

export const getResponse = (responseId: number): Promise<FormResponseDetail> =>
  client.get(`/api/forms/responses/${responseId}`).then(r => r.data);

export const deleteResponse = (responseId: number): Promise<void> =>
  client.delete(`/api/forms/responses/${responseId}`).then(() => undefined);
