import client from './client';
import type { FormResponseDetail } from '../lib/flowTypes';

/** One x-point of a WHO percentile table (x = age in days, or length in cm). */
export interface GrowthStandardPoint {
  x: number;
  p3: number;
  p15: number;
  p50: number;
  p85: number;
  p97: number;
}

export type GrowthIndicator = 'wfa' | 'lfa' | 'wfl';
export type GrowthSex = 'boys' | 'girls';
export type GrowthStandards = Record<GrowthIndicator, Record<GrowthSex, GrowthStandardPoint[]>>;

/** One LAP visit: all form responses filed for a child on one date. */
export interface GrowthVisit {
  date: string;
  age_days: number | null;
  weight: number | null;
  length: number | null;
  /** Form keys filed that day (determines the point/line color). */
  sources: string[];
  /** form_key → response id, for the visit-detail drill-down. */
  forms: Record<string, number>;
}

/** A learner-mother-child triple with its chronological visit series. */
export interface GrowthCase {
  child: {
    id: number;
    uid: string;
    name: string;
    gender: string | null;
    dob: string | null;
    birth_weight: number | null;
    birth_length: number | null;
  };
  mother: { id: number; uid: string; name: string };
  /** learner is null for an orphaned case (registering account removed). */
  learner: { id: number | null; name: string | null; email: string | null; district: string | null };
  visits: GrowthVisit[];
}

// ── Learner-level summary table ───────────────────────────────────────────────

/** Expected / Actual / Incomplete counts (+ %) for one form group. */
export interface ActivityBlock {
  expected: number | null;
  actual: number;
  incomplete: number | null;
  actual_pct: number | null;
  incomplete_pct: number | null;
}

/** A metric at Baseline / Assessment (mid) / Last visit. */
export interface ZTriplet {
  bv: number | null;
  av: number | null;
  lv: number | null;
}

/** One learner-mother-child row of the growth-monitor summary table. */
export interface GrowthSummaryRow {
  case_id: number;
  learner_id: number | null;
  identity: {
    learner_name: string | null;
    role_group: string | null;
    mother_name: string;
    child_uid: string;
  };
  case_details: {
    adoption_type: string | null;
    age_of_adoption_days: number | null;
    adoption_duration_days: number | null;
  };
  activities: { total: ActivityBlock; cg: ActivityBlock; bf: ActivityBlock; cf: ActivityBlock };
  outcomes: { wfaz: ZTriplet; hfaz: ZTriplet; wfhz: ZTriplet };
  meta: {
    sex: string | null;
    district: string | null;
    department: string | null;
    /** Any of these true → that column is a demo/mock value (GROWTH_SUMMARY_MOCK). */
    expected_is_mock: boolean;
    adoption_type_is_mock: boolean;
    timing_is_mock: boolean;
    z_is_mock: boolean;
  };
}

export interface GrowthSummaryLearner {
  id: number;
  name: string;
  role: string | null;
  department: string | null;
  district: string | null;
}

export interface GrowthSummaryFilterOptions {
  learners: GrowthSummaryLearner[];
  roles: string[];
  departments: string[];
}

/** The growth-monitor filters (shared by the table and the charts). */
export interface GrowthFilters {
  district?: string;
  role?: string;
  department?: string;
  learnerId?: number | null;
  /** Narrow to a single case (child) — used by the case-detail page. */
  childId?: number | null;
}

const filterParams = (f: GrowthFilters) => ({
  ...(f.district ? { district: f.district } : {}),
  ...(f.role ? { role: f.role } : {}),
  ...(f.department ? { department: f.department } : {}),
  ...(f.learnerId ? { learner_id: f.learnerId } : {}),
  ...(f.childId ? { child_id: f.childId } : {}),
});

export const getGrowthStandards = (): Promise<GrowthStandards> =>
  client.get('/api/growth/standards').then(r => r.data);

export const getMyGrowthCases = (): Promise<{ cases: GrowthCase[] }> =>
  client.get('/api/growth/my-cases').then(r => r.data);

export const getAdminGrowthMonitor = (filters: GrowthFilters = {}): Promise<{ cases: GrowthCase[] }> =>
  client.get('/api/admin/growth/monitor', { params: filterParams(filters) }).then(r => r.data);

export const getAdminGrowthSummary = (
  filters: GrowthFilters = {},
): Promise<{ rows: GrowthSummaryRow[]; mock: boolean }> =>
  client.get('/api/admin/growth/summary', { params: filterParams(filters) }).then(r => r.data);

export const getGrowthSummaryFilters = (): Promise<GrowthSummaryFilterOptions> =>
  client.get('/api/admin/growth/summary/filters').then(r => r.data);

/** One submitted protein assessment whose 24-hour total was implausibly high. */
export interface ProteinAlert {
  response_id: number;
  assessment_date: string | null;
  mother_id: number | null;
  mother_name: string | null;
  learner_name: string | null;
  total24: number | null;
}

export const getGrowthAlerts = (): Promise<{ alerts: ProteinAlert[]; threshold: number }> =>
  client.get('/api/admin/growth/alerts').then(r => r.data);

/** Download the (filtered) summary table as an .xlsx. Triggers the browser download. */
export const downloadGrowthSummaryXlsx = async (filters: GrowthFilters = {}): Promise<void> => {
  const res = await client.get('/api/admin/growth/summary/export', {
    params: filterParams(filters),
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'growth-summary.xlsx';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const getAdminGrowthResponse = (responseId: number): Promise<FormResponseDetail> =>
  client.get(`/api/admin/growth/responses/${responseId}`).then(r => r.data);

// ── Case drill-down (all forms across all visits) ─────────────────────────────

/** This visit's own z-scores (real measurements only, never mock-filled). */
export interface VisitZ {
  wfaz: number | null;
  hfaz: number | null;
  wfhz: number | null;
}

export interface GrowthVisitDetail {
  date: string;
  age_days: number | null;
  weight: number | null;
  length: number | null;
  /** z of the measurements taken AT this visit. */
  z: VisitZ;
  /** BV/AV/LV triplets computed over the visits up to and including this one. */
  z_to_date: { wfaz: ZTriplet; hfaz: ZTriplet; wfhz: ZTriplet };
  responses: FormResponseDetail[];
}

export interface GrowthCaseDetail {
  child: {
    id: number;
    uid: string;
    name: string;
    gender: string | null;
    dob: string | null;
    birth_weight: number | null;
    birth_length: number | null;
    adoption_date: string | null;
  };
  mother: {
    id: number;
    uid: string;
    name: string;
    mobile: string | null;
    village: string | null;
    age: number | null;
  } | null;
  learner: { id: number; name: string; role: string | null; department: string | null; email: string | null } | null;
  visits: GrowthVisitDetail[];
  mother_forms: FormResponseDetail[];
}

export const getGrowthCaseDetail = (childId: number): Promise<GrowthCaseDetail> =>
  client.get(`/api/admin/growth/cases/${childId}/detail`).then(r => r.data);
