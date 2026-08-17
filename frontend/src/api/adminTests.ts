import client from './client';
import { getProjectSlug } from '../lib/adminProject';

/**
 * Admin test-paper authoring.
 *
 * Questions can be written three ways and they all land in the same place:
 * uploaded as a sheet (replaces the whole paper), added one at a time, or
 * edited in place. Each question and each option may carry an image.
 */

/** Option slots a question can use. Blank slots are simply not stored. */
export const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type OptionLabel = (typeof OPTION_LABELS)[number];

export interface AdminQuestion {
  id: number;
  text: string;
  correct_answer: string;
  marks: number;
  order_index: number;
  image_url: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  option_f: string;
  option_a_image: string;
  option_b_image: string;
  option_c_image: string;
  option_d_image: string;
  option_e_image: string;
  option_f_image: string;
}

export type QuestionDraft = Partial<AdminQuestion> & { text: string };

export interface AdminPhase {
  id: number;
  title: string;
  description: string;
  order_index: number;
  stage_type: 'tutorials' | 'test';
  quiz_enabled: boolean;
  test_count: number;
}

const q = () => `district=${getProjectSlug() ?? ''}`;

export const emptyQuestionDraft = (): AdminQuestion => ({
  id: 0,
  text: '',
  correct_answer: 'A',
  marks: 0,
  order_index: 0,
  image_url: '',
  option_a: '', option_b: '', option_c: '', option_d: '', option_e: '', option_f: '',
  option_a_image: '', option_b_image: '', option_c_image: '',
  option_d_image: '', option_e_image: '', option_f_image: '',
});

export const listPhases = (): Promise<AdminPhase[]> =>
  client.get(`/api/admin/stages?${q()}`).then(r => r.data);

export const addQuestion = (testId: number, draft: QuestionDraft): Promise<AdminQuestion> =>
  client.post(`/api/admin/tests/${testId}/questions?${q()}`, draft).then(r => r.data);

export const saveQuestion = (questionId: number, draft: QuestionDraft): Promise<AdminQuestion> =>
  client.put(`/api/admin/questions/${questionId}?${q()}`, draft).then(r => r.data);

export const moveQuestion = (questionId: number, direction: 'up' | 'down'): Promise<void> =>
  client.post(`/api/admin/questions/${questionId}/move?${q()}`, { direction }).then(() => undefined);

export const deleteQuestion = (questionId: number): Promise<void> =>
  client.delete(`/api/admin/questions/${questionId}?${q()}`).then(() => undefined);

/** Upload a question/option picture; returns a backend-relative `/uploads/...` URL. */
export const uploadTestImage = (file: File): Promise<string> => {
  const data = new FormData();
  data.append('file', file);
  return client
    .post('/api/admin/tests/assets', data, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then(r => r.data.url as string);
};
