/**
 * MASD — Member Activity Summary Dashboard (admin).
 *
 * The district report the analysts used to build with scripts — adoption
 * target fulfilment, activity intensity, and malnutrition outcomes against
 * NFHS — computed by the backend (app/masd/) from NurtureHUB's own records.
 * These types mirror app/masd/engine.py; every number arrives computed, the
 * page only draws.
 */
import client from './client';

export type Tone = 'good' | 'watch' | 'info';
export interface MasdFinding { tone: Tone; text: string }

export type ActivityKey = 'anc' | 'protein' | 'gm' | 'bf' | 'cf';
export const ACTIVITY_KEYS: ActivityKey[] = ['anc', 'protein', 'gm', 'bf', 'cf'];
export type Indicator = 'stunting' | 'underweight' | 'wasting';
export const INDICATORS: Indicator[] = ['stunting', 'underweight', 'wasting'];
export type Band = 'lt6' | 'm6_11';

export interface MasdGroup {
  key: string;
  label: string;
  learners: number;
  nurses: number;
  mtfl: number;
  adoptions: number;
  mix: { anc: number; pnc_lt5: number; pnc_ge5: number; unknown: number };
  target: number;
  fulfilment_pct: number | null;
  activities: number;
  ideal: number;
  intensity_pct: number | null;
  subtype_actual: Record<ActivityKey, number>;
  subtype_ideal: Record<ActivityKey, number>;
  subtype_pct: Record<ActivityKey, number | null>;
  nil_days_avg: number | null;
  no_activity: number;
  zero_adoptions: number;
}

export interface MasdLearner {
  id: number;
  name: string;
  email: string;
  role: string | null;
  role_group: string;
  department: string;
  block: string;
  f2f: boolean;
  trainer_role: 'master_trainer' | 'facilitator' | null;
  mtfl: boolean;
  is_nurse: boolean;
  adoptions: { anc: number; pnc_lt5: number; pnc_ge5: number; unknown: number; total: number };
  target: number;
  fulfilment_pct: number | null;
  activities: Record<ActivityKey, number> & { total: number };
  ideal: Record<ActivityKey, number> & { total: number };
  intensity_pct: number | null;
  subtype_pct: Record<ActivityKey, number | null>;
  last_activity: string | null;
  first_activity: string | null;
  nil_days: number | null;
  avg_per_adoption: number | null;
}

export interface MasdAttention {
  id: number;
  name: string;
  block: string;
  role_group: string;
  adoptions: number;
  fulfilment_pct: number | null;
  intensity_pct: number | null;
  nil_days: number | null;
  reasons: ('no_activity' | 'inactive' | 'low_intensity' | 'few_adoptions')[];
}

export interface IndicatorPrev {
  bv: number | null; av: number | null; lv: number | null;
  n_bv: number; n_av: number; n_lv: number;
  abs_change: number | null; rel_change: number | null;
}
export type Prevalence = { n: number } & Record<Indicator, IndicatorPrev>;

export interface Share { label: string; n: number; pct: number | null }

export interface Benchmarks {
  label: string;
  age_bands: Partial<Record<Band, Partial<Record<Indicator, number | null>>>>;
  district_trend?: {
    label: string;
    rounds: string[];
    stunting: (number | null)[];
    underweight: (number | null)[];
    wasting: (number | null)[];
  } | null;
}

export interface MasdOutcomes {
  funnel: { key: string; learners_after: number; cases_after: number; learners_removed: number; cases_removed: number }[];
  exclusions: {
    reasons: { key: string; label: string; mtfl: number; other: number; total: number }[];
    included: { mtfl: number; other: number; total: number };
    total: { mtfl: number; other: number; total: number };
    inclusion_pct: number | null;
    inclusion_pct_mtfl: number | null;
    inclusion_pct_other: number | null;
  };
  retention: {
    learners: { role_group: string; total: number; final: number; pct: number | null }[];
    adoptions: { role_group: string; total: number; final: number; pct: number | null }[];
  };
  demographics: {
    n: number;
    mother_age: Share[];
    ration_card: Share[];
    social_category: Share[];
    delivery_place: Share[];
    delivery_method: Share[];
  };
  prevalence: {
    overall: Prevalence;
    mtfl: Prevalence;
    other: Prevalence;
    bands: Record<Band, { all: Prevalence; mtfl: Prevalence; other: Prevalence }>;
  };
  compliance: Record<Band, { rule: { min_visits: number; min_follow_up_days: number }; yes: Prevalence; no: Prevalence }>;
  benchmarks: Benchmarks | null;
  data_fixes: { id: number; name: string; block: string; cases: number; reasons: Record<string, number> }[];
}

export interface ComparisonSnapshot {
  as_of: string;
  tranches_in_force: number;
  learners: number;
  target_per_learner: number;
  adoptions: number;
  target: number;
  fulfilment_pct: number | null;
  intensity_pct: number | null;
  nil_days_avg: number | null;
  cohort: number;
  cohort_lt6: number;
  cohort_6_11: number;
  nurses: { learners: number; fulfilment_pct: number | null; intensity_pct: number | null; nil_days_avg: number | null } | null;
  underweight: Record<Band, { n: number; av: number | null; lv: number | null; abs_change: number | null }>;
}

export interface MasdComparison {
  then: ComparisonSnapshot;
  now: ComparisonSnapshot;
  blocks: {
    key: string; label: string;
    fulfilment_then: number | null; fulfilment_now: number | null; fulfilment_change: number | null;
    intensity_then: number | null; intensity_now: number | null; intensity_change: number | null;
  }[];
}

export interface MasdReport {
  project: { id: number; slug: string; name: string; level: string | null };
  as_of: string;
  calendar: {
    training_date: string | null;
    tranche2_start: string | null;
    inferred: boolean;
    saved: boolean;
    tranches_in_force: number;
    due_fraction: { t1: number; t2: number };
    prorated: boolean;
  };
  summary: MasdGroup & {
    learners_all: number;
    non_f2f_learners_with_cases: number;
    non_f2f_cases: number;
    tranche_mix: Record<string, number>;
  };
  blocks: MasdGroup[];
  roles: MasdGroup[];
  departments: MasdGroup[];
  distribution: Record<string, Record<string, number>>;
  learners: MasdLearner[];
  weekly: ({ week: string; adoptions: number; total: number } & Record<ActivityKey, number>)[];
  attention: MasdAttention[];
  outcomes: MasdOutcomes;
  rules: {
    ideal_per_adoption: Record<string, Record<string, Partial<Record<ActivityKey, number>>>>;
    ideal_learner: { standard: Record<ActivityKey, number>; nurse: Record<ActivityKey, number> };
    target: number;
    five_months_days: number;
    compliance: Record<Band, { min_visits: number; min_follow_up_days: number }>;
    min_follow_up_months: Record<string, number>;
    exclusion_reasons: [string, string][];
  };
  comparison: MasdComparison | null;
  insights: Record<string, MasdFinding[]>;
}

export interface MasdProject {
  slug: string;
  name: string;
  level: string | null;
  f2f_learners: number;
  calendar_saved: boolean;
}

export interface MasdSettings {
  project: string;
  training_date: string | null;
  tranche2_start: string | null;
  benchmarks: Benchmarks | null;
  benchmarks_are_default: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export interface ReportParams {
  project: string;
  asOf?: string;
  compare?: string;
}

const params = ({ project, asOf, compare }: ReportParams) => ({
  project,
  ...(asOf ? { as_of: asOf } : {}),
  ...(compare ? { compare } : {}),
});

export const getMasdProjects = () =>
  client.get<MasdProject[]>('/api/admin/masd/projects').then(r => r.data);

export const getMasdReport = (p: ReportParams) =>
  client.get<MasdReport>('/api/admin/masd/report', { params: params(p) }).then(r => r.data);

export const getMasdSettings = (project: string) =>
  client.get<MasdSettings>('/api/admin/masd/settings', { params: { project } }).then(r => r.data);

export const saveMasdSettings = (
  project: string,
  body: { training_date: string | null; tranche2_start: string | null; benchmarks: Benchmarks | null },
) => client.put<MasdSettings>('/api/admin/masd/settings', body, { params: { project } }).then(r => r.data);

export const setTrainerRole = (userId: number, trainerRole: MasdLearner['trainer_role']) =>
  client.put(`/api/admin/masd/learners/${userId}/trainer-role`, { trainer_role: trainerRole }).then(r => r.data);

/** Server-named file (Content-Disposition), saved through a blob link. */
export const downloadMasd = async (fmt: 'pptx' | 'xlsx', p: ReportParams): Promise<void> => {
  const res = await client.get(`/api/admin/masd/report/${fmt}`, { params: params(p), responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `MASD_${p.project}.${fmt}`;
  const url = URL.createObjectURL(res.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
