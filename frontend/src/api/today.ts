import client from './client';

/** The health worker's home (launch review of 19 Oct 2026) — backend
 *  GET /api/dashboard/today, app/fieldplan.py. Her own cases only. */

export type FormCode = 'gm' | 'bf' | 'cf' | 'anc' | 'protein';
export type Tone = 'green' | 'yellow' | 'red';
export type Status = Tone | 'none';

export interface BabyStatus {
  status: Status;
  /** weight_fell | not_gaining | low_wfa | low_lfa | low_wfl | no_growth_check */
  reasons: string[];
  see_within_days: number | null;
  latest: {
    date: string;
    age_days: number | null;
    weight: number | null;
    length: number | null;
    wfa: { pct: number | null; tone: Tone | null };
    lfa: { pct: number | null; tone: Tone | null };
    wfl: { grade: 'normal' | 'mild' | 'moderate' | 'severe' | null; tone: Tone | null };
  } | null;
  previous: { date: string; weight: number | null; wfa_pct: number | null } | null;
}

export interface TaskForm { key: FormCode; late_days: number; missing: number }

export interface TaskGroup {
  mother_id: number;
  mother_name: string;
  child_id: number | null;
  child_name: string | null;
  forms: TaskForm[];
  late_days: number;
  due_on: string;
}

export interface UrgentBaby {
  mother_id: number;
  mother_name: string;
  child_id: number;
  child_name: string;
  status: Status;
  reasons: string[];
  see_within_days: number;
  forms: FormCode[];
  last_check: string | null;
}

export interface CaseRow {
  mother_id: number;
  mother_name: string;
  mother_uid: string;
  type: 'anc' | 'pnc_lt5' | 'pnc_ge5' | 'sn' | 'unknown' | null;
  status: Status;
  /** all_done | late | due_today | finish_registration | edd_passed | a baby reason */
  reason: string;
  next: { due_on: string; forms: FormCode[]; child_id: number | null } | null;
  children: ({ id: number; name: string; uid: string; gender: string | null; age_days: number | null } & BabyStatus)[];
}

export interface TodayView {
  available: boolean;
  as_of: string;
  project: { name: string; slug: string } | null;
  urgent: UrgentBaby[];
  today: TaskGroup[];
  /** Registration not finished; `then` is what follows the missing step. */
  finish: { mother_id: number; mother_name: string; missing: 'protein' | 'baby'; then: 'baby'[] }[];
  targets: { type: 'anc' | 'pnc_lt5' | 'pnc_ge5'; target: number; adopted: number; more: number }[];
  week: { date: string; items: TaskGroup[] }[];
  cases: CaseRow[];
  done_this_week: number;
  nil_days: number | null;
}

export const getToday = (): Promise<TodayView> => client.get('/api/dashboard/today').then(r => r.data);

/** Where a form is filled. */
export const FORM_KEY: Record<FormCode, string> = {
  gm: 'growth_monitoring', bf: 'breastfeeding', cf: 'complementary_feeding',
  anc: 'antenatal', protein: 'mother_protein_intake',
};

export const formRunUrl = (code: FormCode, motherId: number, childId: number | null, flow?: string) => {
  const key = FORM_KEY[code];
  const base = code === 'anc' || code === 'protein' || childId == null
    ? `/mothers/${motherId}/assessments/${key}/run`
    : `/mothers/${motherId}/children/${childId}/assessments/${key}/run`;
  return flow ? `${base}?flow=${encodeURIComponent(flow)}` : base;
};
