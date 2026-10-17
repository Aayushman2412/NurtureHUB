import client from './client';

/**
 * Registration by project (review of 17 Oct 2026) — see backend
 * app/registration.py. A project's sign-up link (/join/<slug>) is remembered
 * on this device until the learner finishes registering, so the state and
 * district come pre-filled and locked even across the sign-up and OTP steps.
 */
export interface RegistrationPlace {
  project: { slug: string; name: string };
  state: { id: number; name: string } | null;
  district: { id: number; name: string } | null;
}

export interface RegistrationScope {
  locked: RegistrationPlace | null;
  link_closed: boolean;
  places: RegistrationPlace[];
  state_ids: number[] | null;
  district_ids: number[] | null;
}

export const getRegistrationScope = (project?: string | null): Promise<RegistrationScope> =>
  client.get('/api/metadata/registration-scope', { params: project ? { project } : {} }).then(r => r.data);

const KEY = 'nh_join_project';

export const joinProjectSlug = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const setJoinProject = (slug: string) => {
  try {
    localStorage.setItem(KEY, slug.trim().toLowerCase());
  } catch { /* private window: the link still works for this page view */ }
};

export const clearJoinProject = () => {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to clear */ }
};

/** Admin: where a project registers, and whether it is open. */
export const putProjectRegistration = (
  projectId: number, body: { open: boolean; state_id: number | null; district_id: number | null },
) => client.put(`/api/admin/projects/${projectId}/registration`, body).then(r => r.data);
