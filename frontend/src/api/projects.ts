/** Admin projects (districts + states) API. */
import client from './client';
import type { AdminProject } from '../lib/adminProject';

export interface ProjectGroups {
  /** State projects with their child district projects. */
  states: { state: AdminProject; children: AdminProject[] }[];
  /** District projects that do not live inside a state. */
  standalone: AdminProject[];
  /** Flat list of every project, states and districts alike. */
  flat: AdminProject[];
}

export const listProjects = (): Promise<AdminProject[]> =>
  client.get('/api/admin/projects').then(r => r.data);

export interface ProjectPayload {
  name: string;
  level: 'district' | 'state';
  parent_id?: number | null;
  inherits_content?: boolean;
  code?: string | null;
  state_prefix?: string | null;
}

export const createProject = (payload: ProjectPayload): Promise<AdminProject> =>
  client.post('/api/admin/projects', payload).then(r => r.data);

export const updateProject = (
  id: number,
  payload: Partial<Omit<ProjectPayload, 'level' | 'parent_id'>> & { is_active?: boolean },
): Promise<AdminProject> =>
  client.put(`/api/admin/projects/${id}`, payload).then(r => r.data);

export const deleteProject = (id: number): Promise<void> =>
  client.delete(`/api/admin/projects/${id}`).then(() => undefined);

/** Split the API's tree response into the shapes the UI renders. */
export function groupProjects(list: AdminProject[]): ProjectGroups {
  const states: ProjectGroups['states'] = [];
  const standalone: AdminProject[] = [];
  const flat: AdminProject[] = [];
  for (const project of list) {
    flat.push(project);
    if (project.level === 'state') {
      const children = project.children ?? [];
      flat.push(...children);
      states.push({ state: project, children });
    } else if (!project.parent_id) {
      standalone.push(project);
    }
  }
  return { states, standalone, flat };
}

/**
 * The project a fresh admin session should land on.
 *
 * Never a state by default: state projects edit state-wide content, so
 * defaulting there would have an admin unknowingly editing every district's
 * inherited phases. A district is always preferred; a state is used only when
 * no district project exists at all.
 */
export function defaultProject(groups: ProjectGroups): AdminProject | null {
  const districts = groups.flat.filter(p => p.level === 'district');
  return districts[0] ?? groups.flat[0] ?? null;
}
