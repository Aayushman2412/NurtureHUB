import client from './client';

/** Admin learner directory — search, edit, reassign, delete. */

export interface AdminLearner {
  id: number;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  learner_category: string | null;
  work_center_name: string | null;
  is_verified: boolean;
  is_admin: boolean;
  created_at: string | null;
  program_district_id: number | null;
  program_district_name: string | null;
  /** Submitted test attempts — shown before deleting so the loss is visible. */
  attempts: number;
  /** Mothers they registered; these survive the account (registrar is nulled). */
  mothers: number;
}

export interface LearnerPage {
  total: number;
  limit: number;
  offset: number;
  users: AdminLearner[];
}

export interface LearnerQuery {
  q?: string;
  /** Project id, or -1 for "not assigned to any project". */
  projectId?: number | null;
  limit?: number;
  offset?: number;
}

export const listLearners = ({ q, projectId, limit = 100, offset = 0 }: LearnerQuery): Promise<LearnerPage> => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q) params.set('q', q);
  if (projectId !== null && projectId !== undefined) params.set('project_id', String(projectId));
  return client.get(`/api/admin/users?${params.toString()}`).then(r => r.data);
};

export const updateLearner = (id: number, patch: Partial<AdminLearner>): Promise<AdminLearner> =>
  client.put(`/api/admin/users/${id}`, patch).then(r => r.data);

export const deleteLearner = (id: number): Promise<void> =>
  client.delete(`/api/admin/users/${id}`).then(() => undefined);

export const bulkAssignLearners = (
  userIds: number[],
  programDistrictId: number | null,
): Promise<{ moved: number }> =>
  client
    .post('/api/admin/users/bulk-assign', { user_ids: userIds, program_district_id: programDistrictId })
    .then(r => r.data);
