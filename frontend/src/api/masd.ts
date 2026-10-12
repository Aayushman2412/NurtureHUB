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
export type MainIndicator = 'stunting' | 'underweight' | 'wasting';
/** The severe forms, below −3 SD (SAM = severe wasting). */
export type SevereIndicator = 'severe_stunting' | 'severe_underweight' | 'sam';
export type Indicator = MainIndicator | SevereIndicator;
export const MAIN_INDICATORS: MainIndicator[] = ['stunting', 'underweight', 'wasting'];
export const SEVERE_INDICATORS: SevereIndicator[] = ['severe_stunting', 'severe_underweight', 'sam'];
export const INDICATORS: Indicator[] = [...MAIN_INDICATORS, ...SEVERE_INDICATORS];
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
  /** Per activity, for the visit-vs-intervention bubble charts (learner rows and the summary). */
  expected_by?: Partial<Record<ActivityKey, number>>;
  actual_by?: Partial<Record<ActivityKey, number>>;
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
  /** Median and interquartile range of the days since the last activity. */
  nil_days_median?: number | null;
  nil_days_q1?: number | null;
  nil_days_q3?: number | null;
  /** Level 2: activities expected for the adoptions actually taken, and done. */
  undertaken_expected?: number;
  undertaken_actual?: number;
  undertaken_pct?: number | null;
  no_activity: number;
  zero_adoptions: number;
  /** Learners with adoptions but no activity — never counted in zero_adoptions. */
  adopted_no_activity?: number;
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
  /** Shown to admins beside the name, with the user ID. */
  mobile?: string | null;
  /** For splitting and describing learners. */
  district?: string | null;
  education?: string | null;
  experience?: string | null;
  experience_order?: number;
  /** Adoptions whose declared type differs from the one worked out from the dates. */
  declared_mismatch?: number;
  /** Tagged a batch monitor. */
  is_monitor?: boolean;
  /** The batch monitor watching this learner, and their name. */
  monitor_id?: number | null;
  monitor?: string | null;
  is_nurse: boolean;
  batch_id: number | null;
  batch: string | null;
  training_end: string | null;
  /** The first tranche's follow-up — the learner's time in the field. */
  fu_raw: number | null;
  fu_days: number | null;
  /** Every open tranche's follow-up (days counted), in order. */
  tranche_fu: number[];
  /** Days from each tranche opening to the first / completing adoption; negative = before it opened.
   *  nth: days to each adoption asked (null = not made); types: the kind of each one made. */
  uptake?: {
    step: number; started_days: number | null; completed_days: number | null;
    nth?: (number | null)[]; types?: AdoptionType[]; asked?: number;
  }[];
  adoptions: { anc: number; pnc_lt5: number; pnc_ge5: number; unknown: number; total: number };
  targets: Record<AdoptionType, number> & { total: number };
  target: number;
  fulfilment_pct: number | null;
  activities: Record<ActivityKey, number> & { total: number };
  ideal: Record<ActivityKey, number> & { total: number };
  intensity_pct: number | null;
  subtype_pct: Record<ActivityKey, number | null>;
  by_type: Record<AdoptionType, TypeFigures>;
  /** Level 2: expected for the adoptions this learner took (read at their tranches). */
  undertaken?: { expected: Record<ActivityKey, number> & { total: number }; actual: number; pct: number | null };
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

/** One NFHS column: a value per indicator, and the survey's sample size. */
export type BenchValues = Partial<Record<Indicator, number | null>> & { n?: number | null };

export interface Benchmarks {
  label: string;
  age_bands: Partial<Record<Band, BenchValues>>;
  /** District fact sheets give under-5 figures only. */
  under5?: BenchValues | null;
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
    education?: Share[];
    place_by_method?: { places: string[]; methods: string[]; counts: Record<string, number> };
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
  /** <6 and 6–11 month NFHS values weighted by their sample sizes (null until entered). */
  benchmarks_lt12: BenchValues | null;
  /** Each learner's eligible dyads, the included ones and why the rest were left out. */
  by_learner?: Record<string, { eligible: number; included: number; reasons: Record<string, number> }>;
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
  activities?: number;
  ideal?: number;
  undertaken_expected?: number;
  undertaken_actual?: number;
  undertaken_pct?: number | null;
  nil_days_median?: number | null;
  nil_days_q1?: number | null;
  nil_days_q3?: number | null;
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
/** One group's uptake of a tranche, with the 1st, 2nd, 3rd … adoption of it. */
export interface UptakeGroup extends Omit<TrancheUptake, 'step' | 'from' | 'buffer' | 'added'> {
  q1_days_to_start: number | null;
  q3_days_to_start: number | null;
  q1_days_to_complete: number | null;
  q3_days_to_complete: number | null;
  nth: { n: number; learners: number; done: number; by: Record<UptakeBucket, number>;
    types?: Record<AdoptionType, number>;
    median: number | null; q1: number | null; q3: number | null }[];
}
export type UptakeGroupKey = 'rol' | 'sn' | 'all';
export type TrancheUptakeFull = TrancheUptake & { groups?: Record<UptakeGroupKey, UptakeGroup> };

/** Expected and actual adoptions and activities, cumulative, day by day. */
export interface CumulativeDay {
  date: string;
  expected_adoptions: number;
  adoptions: number;
  expected_activities: number;
  activities: number;
  /** What the cases actually adopted were due, each by its own dates (level 3). */
  expected_cases?: number;
}
export type CumulativeKind = 'anc' | 'pnc_lt5' | 'pnc_ge5' | 'sn';
export interface CumulativeSeries {
  days: CumulativeDay[];
  tranches: { step: number; from: string | null; clock_from: string | null }[];
  learners: number;
  kind: CumulativeKind | null;
  per_case: boolean;
}

/** One made-up learner worked through the three levels on this project's tranches. */
export interface LevelsExample {
  asked: Record<AdoptionType, number>;
  asked_total: number;
  level1: number;
  level2: number;
  level3: number;
  cases: { tranche: number; type: AdoptionType; adopted: string; baby_age_days: number | null;
    fu_days: number | null; own_days: number; level2: number; level3: number }[];
  tranches: { step: number; clock_from: string; fu_days: number | null }[];
}

export type PncFlagReason = 'visits_missed' | 'no_recent_visit';
export interface PncFlag {
  mother_id: number;
  mother_uid: string | null;
  learner_id: number;
  learner: string;
  monitor?: string | null;
  block: string;
  f2f: boolean;
  type: AdoptionType;
  adopted: string | null;
  dob: string;
  visits_due: number;
  visits_done: number;
  visits_missed: number;
  last_visit: string | null;
  days_since_visit: number;
  reasons: PncFlagReason[];
}
export interface TypeMismatch {
  mother_id: number;
  mother_uid: string | null;
  learner_id: number;
  learner: string;
  monitor?: string | null;
  block: string;
  declared: AdoptionType;
  computed: AdoptionType;
  adopted: string | null;
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
  start_date?: string | null;
  trainers?: { name: string; phone: string | null; role: string | null }[];
  monitors?: { id: number; name: string }[];
  without_monitor?: number;
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
  /** Each batch monitor and the learners they answer for. */
  batch_monitors?: {
    monitors: MasdMonitor[];
    f2f_without_monitor: number;
  };
  flags: {
    summary: { open_pregnancies: number; flagged: number } & Record<FlagReason, number>;
    items: PregnancyFlag[];
    pnc?: PncFlag[];
    pnc_summary?: { followed: number; flagged: number } & Record<PncFlagReason, number>;
    type_mismatch?: TypeMismatch[];
    by_block: { block: string; n: number }[];
    by_learner: { id: number; name: string; block: string; n: number }[];
  };
  uptake: TrancheUptakeFull[];
  cumulative?: CumulativeSeries;
  levels_example?: LevelsExample | null;
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
      lap_days?: Record<ActivityKey, number[]>;
      nurse_flat?: Partial<Record<ActivityKey, number>>;
      pnc_flag_missed?: number;
      pnc_flag_silent_days?: number;
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

export interface BatchTrainer { name: string; phone: string | null; role: string | null }
export interface MasdBatch {
  id: number | null;
  name: string;
  start_date?: string | null;
  end_date: string;
  trainers?: BatchTrainer[];
  learners?: number;
}

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

/** One batch monitor: how many learners they watch, how many are on track
 *  and which need a call this week. */
export interface MasdMonitor {
  id: number;
  name: string;
  block: string;
  role_group: string;
  learners: number;
  on_track: number;
  need_call: number;
  own_pct: number | null;
  adoptions: number;
  calls: MasdAttention[];
}

/** Tag a learner as a batch monitor (or remove the tag — their learners are freed). */
export const setBatchMonitorTag = (userId: number, isMonitor: boolean) =>
  client.put<{ user_id: number; is_batch_monitor: boolean; released: number }>(
    `/api/admin/masd/learners/${userId}/batch-monitor`, { is_batch_monitor: isMonitor }).then(r => r.data);

/** Give a learner a batch monitor (null = none). */
export const setLearnerMonitor = (userId: number, monitorId: number | null) =>
  client.put(`/api/admin/masd/learners/${userId}/monitor`, { batch_monitor_id: monitorId }).then(r => r.data);

/** Give many learners the same batch monitor. */
export const setMonitorLearners = (monitorId: number, userIds: number[]) =>
  client.put<{ monitor_id: number; assigned: number; skipped: number }>(
    `/api/admin/masd/monitors/${monitorId}/learners`, { user_ids: userIds }).then(r => r.data);

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

export interface BatchUploadRow {
  row: number;
  user_id: number | null;
  name: string;
  learner?: string;
  batch: string;
  from?: string | null;
  status: 'assign' | 'assigned' | 'unchanged' | 'error';
  message: string;
}
export interface BatchUploadResult {
  applied: boolean;
  summary: Record<'assign' | 'assigned' | 'unchanged' | 'error', number>;
  rows: BatchUploadRow[];
}

/** Check (apply=false) or apply an Excel of user ID, name and batch. */
export const uploadBatchAssignments = (project: string, file: File, apply: boolean) => {
  const form = new FormData();
  form.append('file', file);
  return client.post<BatchUploadResult>('/api/admin/masd/batches/assign-upload', form,
    { params: { project, apply } }).then(r => r.data);
};

const saveBlob = (data: Blob, disposition: string, fallback: string) => {
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallback;
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadBatchTemplate = async (project: string) => {
  const res = await client.get('/api/admin/masd/batches/assign-template', { params: { project }, responseType: 'blob' });
  saveBlob(res.data as Blob, String(res.headers['content-disposition'] ?? ''), `batch_assignment_${project}.xlsx`);
};

/** One follow-up list as Excel, filtered as on screen (audited as an export). */
export const downloadFlagList = async (
  project: string, kind: 'anc' | 'pnc' | 'mismatch',
  opts: { asOf?: string; types?: string[]; blocks?: string[]; reasons?: string[] } = {},
) => {
  const res = await client.get('/api/admin/masd/flags/xlsx', {
    params: {
      project, kind,
      ...(opts.asOf ? { as_of: opts.asOf } : {}),
      ...(opts.types?.length ? { types: opts.types.join(',') } : {}),
      ...(opts.blocks?.length ? { blocks: opts.blocks.join(',') } : {}),
      ...(opts.reasons?.length ? { reasons: opts.reasons.join(',') } : {}),
    },
    responseType: 'blob',
  });
  saveBlob(res.data as Blob, String(res.headers['content-disposition'] ?? ''), `MASD_${kind}_followup.xlsx`);
};

/** The cumulative series for the filtered learners and one kind of adoption. */
export const getMasdCumulative = (
  project: string,
  body: { as_of?: string; learner_ids?: number[] | null; kind?: CumulativeKind | null; per_case?: boolean },
) => client.post<CumulativeSeries>('/api/admin/masd/cumulative', body, { params: { project } }).then(r => r.data);

export const getExpectedForms = () =>
  client.get<ExpectedFormsState>('/api/admin/masd/expected-forms').then(r => r.data);

export const saveExpectedForms = (table: ExpectedFormsTable) =>
  client.put<ExpectedFormsState>('/api/admin/masd/expected-forms', table).then(r => r.data);

export const resetExpectedForms = () =>
  client.delete<ExpectedFormsState>('/api/admin/masd/expected-forms').then(r => r.data);

/** Server-named file (Content-Disposition), saved through a blob link. */
export const downloadMasd = async (fmt: 'pptx' | 'xlsx', p: ReportParams): Promise<void> => {
  const res = await client.get(`/api/admin/masd/report/${fmt}`, { params: params(p), responseType: 'blob' });
  saveBlob(res.data as Blob, String(res.headers['content-disposition'] ?? ''), `MASD_${p.project}.${fmt}`);
};
