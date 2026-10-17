import client from './client';
import type { CumulativeSeries } from './masd';

/**
 * A learner's own work, from the MASD rules (review of 17 Oct 2026) —
 * backend GET /api/dashboard/my-work. Forms are keyed anc / protein / gm /
 * bf / cf (antenatal, protein count, growth check, breastfeeding,
 * complementary feeding).
 */
export type FormCounts = Record<'anc' | 'protein' | 'gm' | 'bf' | 'cf', number>;

/** A supervisors' follow-up warning on one of the learner's own cases. */
export interface CaseWarning {
  code: 'edd_passed' | 'anc_behind' | 'no_lmp' | 'visits_missed' | 'no_recent_visit' | 'type_mismatch';
  days_past_edd?: number | null;
  edd?: string | null;
  anc_expected?: number;
  anc_done?: number;
  visits_missed?: number;
  days_since_visit?: number;
  declared?: string;
  computed?: string;
}

export interface MyWorkCase {
  mother_id: number;
  mother_name: string;
  mother_uid: string | null;
  children: { id: number; name: string | null; alerts: { metric: string; label: string; severe: boolean }[] }[];
  type: 'anc' | 'pnc_lt5' | 'pnc_ge5' | 'unknown';
  adopted_on: string | null;
  expected: FormCounts;
  done: FormCounts;
  behind: FormCounts;
  upcoming: FormCounts;
  behind_total: number;
  upcoming_total: number;
  severe: boolean;
  growth_alert: boolean;
  warnings: CaseWarning[];
  last_form: string | null;
  days_since_form: number;
  /** Anything a supervisor would call about: behind, warned, or a low growth result. */
  faltering: boolean;
}

export interface MyWork {
  available: boolean;
  reason?: 'no_project' | 'not_in_project';
  project?: { name: string; slug: string };
  as_of?: string;
  due_days?: number;
  f2f?: boolean;
  targets?: { anc: number; pnc_lt5: number; pnc_ge5: number; total: number };
  adoptions?: { anc: number; pnc_lt5: number; pnc_ge5: number; unknown: number; total: number };
  fulfilment_pct?: number | null;
  own?: { expected: FormCounts & { total: number }; actual: FormCounts & { total: number }; pct: number | null };
  last_activity?: string | null;
  nil_days?: number | null;
  cases?: MyWorkCase[];
  behind_total?: number;
  upcoming_total?: number;
  faltering_total?: number;
  cumulative?: CumulativeSeries;
}

export interface MyTeamRow {
  id: number;
  name: string;
  role_group: string;
  adoptions: number;
  target: number;
  fulfilment_pct: number | null;
  forms_done: number;
  forms_due: number;
  forms_pct: number | null;
  nil_days: number | null;
  last_activity: string | null;
}

export const getMyWork = (dueDays = 7): Promise<MyWork> =>
  client.get('/api/dashboard/my-work', { params: { due_days: dueDays } }).then(r => r.data);

export const getMyTeam = (): Promise<{ learners: MyTeamRow[] }> =>
  client.get('/api/dashboard/my-team').then(r => r.data);
