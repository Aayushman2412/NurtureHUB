/**
 * MASD — Member Activity Summary Dashboard (admin).
 *
 * The district report the analysts used to build with scripts — adoption
 * target fulfilment, the share of EXPECTED activity done (against the targets
 * in force at each learner's follow-up, and within their own cases), the
 * pregnancies that need following up, and malnutrition outcomes against NFHS —
 * computed by the backend (app/masd/) from NurtureHUB's own records.
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
export type AdoptionType = 'anc' | 'pnc_lt5' | 'pnc_ge5';
export const ADOPTION_TYPES: AdoptionType[] = ['anc', 'pnc_lt5', 'pnc_ge5'];
export type OwnBand = 'none' | 'b1_20' | 'b21_40' | 'b41_60' | 'b61_80' | 'b81_100';
export const OWN_BANDS: OwnBand[] = ['none', 'b1_20', 'b21_40', 'b41_60', 'b61_80', 'b81_100'];
export type TableRowType = AdoptionType | 'nurse_lt5';

/** Adoption target met vs expected activity done, for one adoption type. */
export interface TypeFigures {
  target: number;
  adopted: number;
  adoption_pct: number | null;
  expected: number;
  actual: number;
  activity_pct: number | null;
}

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
  by_type: Record<AdoptionType, TypeFigures>;
  own_expected: number;
  own_actual: number;
  own_pct: number | null;
  own_bands: Record<OwnBand, number>;
  own_banded: number;
  fu_days_avg: number | null;
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
  batch_id: number | null;
  batch: string | null;
  training_end: string | null;
  /** The first tranche's follow-up — the learner's time in the field. */
  fu_raw: number | null;
  fu_days: number | null;
  /** Every open tranche's follow-up (days counted), in order. */
  tranche_fu: number[];
  /** Days from each tranche opening to the first / completing adoption; negative = before it opened. */
  uptake?: { step: number; started_days: number | null; completed_days: number | null }[];
  adoptions: { anc: number; pnc_lt5: number; pnc_ge5: number; unknown: number; total: number };
  targets: Record<AdoptionType, number> & { total: number };
  target: number;
  fulfilment_pct: number | null;
  activities: Record<ActivityKey, number> & { total: number };
  ideal: Record<ActivityKey, number> & { total: number };
  intensity_pct: number | null;
  subtype_pct: Record<ActivityKey, number | null>;
  by_type: Record<AdoptionType, TypeFigures>;
  own: {
    expected: Record<ActivityKey, number> & { total: number };
    actual: Record<ActivityKey, number> & { total: number };
    pct: number | null;
    band: OwnBand | null;
  };
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
  fu_days: number | null;
  learners: number;
  target_per_learner: number;
  targets: Targets;
  own_pct: number | null;
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

export interface Targets { anc: number; pnc_lt5: number; pnc_ge5: number; nurse: number }
/** One tranche: the targets from `from` on, its follow-up counted after `buffer` days (null = default). */
export interface TargetStep extends Targets { from: string | null; buffer?: number | null }

/** A tranche open on the report date, with its own follow-up. */
export interface Tranche {
  step: number;
  from: string | null;
  opened: string | null;
  buffer: number;
  clock_from: string | null;
  fu_raw: number | null;
  fu_days: number | null;
  added: Targets;
  targets: Targets;
}
export type TrancheExpected = Tranche & { community: ExpectedForLearner; nurse: ExpectedForLearner };

export const UPTAKE_BUCKETS = ['before', 'd7', 'd15', 'd30', 'later', 'not_yet'] as const;
export type UptakeBucket = (typeof UPTAKE_BUCKETS)[number];
export interface TrancheUptake {
  step: number;
  from: string | null;
  buffer: number;
  added: Targets;
  learners: number;
  started: number;
  started_pct: number | null;
  completed: number;
  completed_pct: number | null;
  median_days_to_start: number | null;
  median_days_to_complete: number | null;
  started_by: Record<UptakeBucket, number>;
  completed_by: Record<UptakeBucket, number>;
}

/** Forms one learner is expected to have done: per type, and in all. */
export interface ExpectedForLearner {
  by_type: Partial<Record<AdoptionType, { adoptions: number; per_adoption: Partial<Record<ActivityKey, number>>; forms: Partial<Record<ActivityKey, number>> }>>;
  forms: Record<ActivityKey, number>;
  total: number;
}

export interface BatchView {
  id: number | null;           // null = learners on the project's training date
  name: string | null;
  end_date: string;
  learners: number;
  fu_raw: number | null;
  fu_days: number | null;
  tranche_fu: number[];
  expected: { community: ExpectedForLearner; nurse: ExpectedForLearner; tranches: TrancheExpected[] };
}

export interface ExpectedFormsTable {
  durations: number[];
  rows: Record<TableRowType, Partial<Record<ActivityKey, number[]>>>;
}

export type FlagReason = 'edd_passed' | 'anc_behind' | 'no_lmp';
export interface PregnancyFlag {
  mother_id: number;
  mother_uid: string | null;
  learner_id: number;
  learner: string;
  block: string;
  f2f: boolean;
  adopted: string;
  lmp: string | null;
  edd: string | null;
  days_past_edd: number | null;
  anc_expected: number;
  anc_done: number;
  last_anc: string | null;
  days_since_contact: number;
  reasons: FlagReason[];
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
    buffer_days: number;
    step_days: number;
    fu_raw: number | null;
    fu_days: number | null;
    tranches: TrancheExpected[];
    batches: BatchView[];
    targets: { now: Targets; step: number | null; steps: TargetStep[]; is_default: boolean };
    expected_forms_default: boolean;
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
  flags: {
    summary: { open_pregnancies: number; flagged: number } & Record<FlagReason, number>;
    items: PregnancyFlag[];
    by_block: { block: string; n: number }[];
    by_learner: { id: number; name: string; block: string; n: number }[];
  };
  uptake: TrancheUptake[];
  outcomes: MasdOutcomes;
  rules: {
    expected: {
      buffer_days: number;
      later_buffer_days: number;
      step_days: number;
      max_days: number;
      table: ExpectedFormsTable;
      table_is_default: boolean;
      rows: [TableRowType, ActivityKey][];
      anc_every_days: number;
      pregnancy_days: number;
      cf_age_days: number[];
      bf_until_age_days: number;
      counselling_from_age_days: number;
      baby_max_age_days: number;
    };
    targets: TargetStep[];
    own_bands: [OwnBand, string][];
    flag_reasons: Record<FlagReason, string>;
    five_months_days: number;
    compliance: Record<Band, { min_visits: number; min_follow_up_days: number }>;
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

export interface MasdBatch { id: number | null; name: string; end_date: string; learners?: number }

export interface MasdSettings {
  project: string;
  training_date: string | null;
  tranche2_start: string | null;
  benchmarks: Benchmarks | null;
  benchmarks_are_default: boolean;
  targets: TargetStep[];
  targets_are_default: boolean;
  batches: MasdBatch[];
  updated_by: string | null;
  updated_at: string | null;
}

export interface ExpectedFormsState {
  table: ExpectedFormsTable;
  is_default: boolean;
  default: ExpectedFormsTable;
  rows: [TableRowType, ActivityKey][];
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
  body: {
    training_date: string | null;
    tranche2_start: string | null;
    benchmarks: Benchmarks | null;
    targets?: TargetStep[];
    batches?: MasdBatch[];
  },
) => client.put<MasdSettings>('/api/admin/masd/settings', body, { params: { project } }).then(r => r.data);

export const setTrainerRole = (userId: number, trainerRole: MasdLearner['trainer_role']) =>
  client.put(`/api/admin/masd/learners/${userId}/trainer-role`, { trainer_role: trainerRole }).then(r => r.data);

/** Put an F2F learner in a training batch (null = the project's training date). */
export const setLearnerBatch = (userId: number, batchId: number | null) =>
  client.put<{ user_id: number; batch_id: number | null; batch: string | null; end_date: string | null }>(
    `/api/admin/masd/learners/${userId}/batch`, { batch_id: batchId },
  ).then(r => r.data);

/** A project's batches (and its state's), for batch pickers. */
export const getMasdBatches = (project: string) =>
  client.get<{ id: number; name: string; end_date: string }[]>('/api/admin/masd/batches', { params: { project } })
    .then(r => r.data);

export const getExpectedForms = () =>
  client.get<ExpectedFormsState>('/api/admin/masd/expected-forms').then(r => r.data);

export const saveExpectedForms = (table: ExpectedFormsTable) =>
  client.put<ExpectedFormsState>('/api/admin/masd/expected-forms', table).then(r => r.data);

export const resetExpectedForms = () =>
  client.delete<ExpectedFormsState>('/api/admin/masd/expected-forms').then(r => r.data);

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
