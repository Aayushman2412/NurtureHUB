/**
 * The admin's currently selected PROJECT.
 *
 * A project is either a district (analysis by block) or a state (analysis by
 * district) that contains district projects. Every admin content page scopes
 * itself to the selected project by sending its slug as `?district=` — that
 * wire contract is unchanged, so the backend keeps working exactly as before.
 *
 * The storage key and event name are deliberately the historical ones: an
 * admin mid-session keeps their selection across this upgrade.
 */
export const PROJECT_KEY = 'nh_admin_district';
export const PROJECT_EVENT = 'district-changed';

export type ProjectLevel = 'district' | 'state';

export interface AdminProject {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  user_count?: number;
  level: ProjectLevel;
  parent_id: number | null;
  /** Child district only: serve the parent state's content instead of its own. */
  inherits_content: boolean;
  /** Analytics project code (UJ/JL/ML…) — required to run pipelines. */
  code: string | null;
  /** Raw-file naming prefix (MP/MH/ML). */
  state_prefix: string | null;
  analysis_level?: ProjectLevel;
  children?: AdminProject[];
}

/** Selected project slug, or null when nothing is chosen yet. */
export function getProjectSlug(): string | null {
  return localStorage.getItem(PROJECT_KEY) || null;
}

export function setProjectSlug(slug: string): void {
  localStorage.setItem(PROJECT_KEY, slug);
  window.dispatchEvent(new Event(PROJECT_EVENT));
}

export function clearProjectSlug(): void {
  localStorage.removeItem(PROJECT_KEY);
}

/** Subscribe to project switches (handles listener cleanup). */
export function onProjectChanged(callback: () => void): () => void {
  window.addEventListener(PROJECT_EVENT, callback);
  return () => window.removeEventListener(PROJECT_EVENT, callback);
}
