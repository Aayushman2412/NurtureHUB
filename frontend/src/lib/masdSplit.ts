/**
 * Split by / Filter by for the MASD dashboard (reviews of 6–7 Oct 2026).
 *
 * The report carries every learner's row, so any grouping — cadre, block,
 * department, district, MT+FL, batch, batch monitor, education — is summed
 * here the same way app/masd/engine.py `_aggregate` sums the server's block
 * and cadre groups. Filters narrow the learners first; the split then groups
 * what is left. Totals are always over the filtered learners.
 */
import {
  ACTIVITY_KEYS, ADOPTION_TYPES,
  type ActivityKey, type AdoptionType, type MasdLearner, type MasdOutcomes, type MasdReport,
} from '../api/masd';

export type MasdDim =
  | 'role_group' | 'block' | 'department' | 'district' | 'mtfl' | 'batch' | 'monitor' | 'education' | 'experience';
export const MASD_DIMS: MasdDim[] = [
  'role_group', 'department', 'block', 'district', 'mtfl', 'batch', 'monitor', 'education', 'experience',
];
export type MasdFilters = Partial<Record<MasdDim, string[]>>;

/** Split by one dimension, or Filter by ticked groups of any (the page's state). */
export interface MasdSplitState {
  mode: 'split' | 'filter';
  dim: MasdDim;
  filters: MasdFilters;
}

export const DEFAULT_SPLIT: MasdSplitState = { mode: 'split', dim: 'block', filters: {} };

export const NOT_RECORDED = 'Not recorded';

/** The group a learner falls in. */
export function groupOf(l: MasdLearner, dim: MasdDim): string {
  switch (dim) {
    case 'role_group': return l.role_group;
    case 'block': return l.block || NOT_RECORDED;
    case 'department': return l.department || NOT_RECORDED;
    case 'district': return l.district || NOT_RECORDED;
    case 'mtfl': return l.mtfl ? 'MT+FL' : 'Other learners';
    case 'batch': return l.f2f ? (l.batch ?? 'Project training date') : 'No training batch';
    // A monitor sits in their own group, with the learners they watch.
    case 'monitor': return l.is_monitor ? l.name : (l.monitor ?? 'No monitor');
    case 'education': return l.education || NOT_RECORDED;
    case 'experience': return l.experience || NOT_RECORDED;
  }
}

const ROLE_ORDER = ['AWW', 'AWSup', 'ASHA', 'ASHA Sup', 'ANM', 'CHO', 'Nursing Staff', 'Other'];

/** Groups of a dimension, in a natural order (cadres as the deck lists them,
 *  batches by date, experience by band, everything else by size). */
export function groupsOf(rows: MasdLearner[], dim: MasdDim): string[] {
  const counts = new Map<string, number>();
  const order = new Map<string, number>();
  for (const l of rows) {
    const g = groupOf(l, dim);
    counts.set(g, (counts.get(g) ?? 0) + 1);
    if (dim === 'batch') order.set(g, Math.min(order.get(g) ?? Infinity, l.training_end ? Date.parse(l.training_end) : Infinity));
    if (dim === 'experience') order.set(g, l.experience_order ?? 99);
  }
  const keys = [...counts.keys()];
  const last = (g: string) => (g === NOT_RECORDED || g === 'No monitor' || g === 'No training batch' ? 1 : 0);
  return keys.sort((a, b) => {
    if (last(a) !== last(b)) return last(a) - last(b);
    if (dim === 'role_group') return (ROLE_ORDER.indexOf(a) + 99) % 99 - (ROLE_ORDER.indexOf(b) + 99) % 99;
    if (dim === 'mtfl') return a === 'MT+FL' ? -1 : 1;
    if (dim === 'batch' || dim === 'experience') return (order.get(a) ?? 0) - (order.get(b) ?? 0) || a.localeCompare(b);
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
  });
}

/** Dimensions worth offering: more than one group among these learners. */
export function usefulDims(rows: MasdLearner[]): MasdDim[] {
  return MASD_DIMS.filter(d => new Set(rows.map(l => groupOf(l, d))).size > 1);
}

export function applyFilters(rows: MasdLearner[], filters: MasdFilters, except?: MasdDim): MasdLearner[] {
  const active = (Object.entries(filters) as [MasdDim, string[]][]).filter(([d, v]) => d !== except && v.length);
  if (!active.length) return rows;
  return rows.filter(l => active.every(([d, v]) => v.includes(groupOf(l, d))));
}

export const pct = (a: number, b: number): number | null => (b ? Math.round((1000 * a) / b) / 10 : null);

export function quartiles(values: number[]): { median: number | null; q1: number | null; q3: number | null } {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return { median: null, q1: null, q3: null };
  const at = (q: number) => {
    const pos = (v.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.min(lo + 1, v.length - 1);
    return Math.round((v[lo] + (v[hi] - v[lo]) * (pos - lo)) * 10) / 10;
  };
  return { median: at(0.5), q1: at(0.25), q3: at(0.75) };
}

export interface TypeAgg {
  target: number; adopted: number; adoption_pct: number | null;
  expected: number; actual: number; activity_pct: number | null;
  expected_by: Record<ActivityKey, number>; actual_by: Record<ActivityKey, number>;
}

export interface MasdAgg {
  key: string;
  label: string;
  learners: number;
  nurses: number;
  adoptions: number;
  target: number;
  fulfilment_pct: number | null;
  activities: number;
  ideal: number;
  intensity_pct: number | null;
  undertaken_expected: number;
  undertaken_actual: number;
  undertaken_pct: number | null;
  subtype_actual: Record<ActivityKey, number>;
  subtype_ideal: Record<ActivityKey, number>;
  subtype_pct: Record<ActivityKey, number | null>;
  /** Community learners' adoptions by type, and Staff Nurses' PNC <5M on their own. */
  by_type: Record<AdoptionType, TypeAgg>;
  nurse_lt5: TypeAgg;
  nil: { median: number | null; q1: number | null; q3: number | null };
  zero_adoptions: number;
  adopted_no_activity: number;
}

const zeroKeys = (): Record<ActivityKey, number> => ({ anc: 0, protein: 0, gm: 0, bf: 0, cf: 0 });

function typeAgg(rows: MasdLearner[], t: AdoptionType): TypeAgg {
  const out = { target: 0, adopted: 0, expected: 0, actual: 0, expected_by: zeroKeys(), actual_by: zeroKeys() };
  for (const l of rows) {
    const v = l.by_type[t];
    out.target += v.target;
    out.adopted += v.adopted;
    out.expected += v.expected;
    out.actual += v.actual;
    for (const k of ACTIVITY_KEYS) {
      out.expected_by[k] += v.expected_by?.[k] ?? 0;
      out.actual_by[k] += v.actual_by?.[k] ?? 0;
    }
  }
  return { ...out, adoption_pct: pct(out.adopted, out.target), activity_pct: pct(out.actual, out.expected) };
}

export function aggregate(rows: MasdLearner[], key: string, label: string): MasdAgg {
  const sum = (f: (l: MasdLearner) => number) => rows.reduce((a, l) => a + f(l), 0);
  const adoptions = sum(l => l.adoptions.total);
  const target = sum(l => l.target);
  const activities = sum(l => l.activities.total);
  const ideal = sum(l => l.ideal.total);
  const und_exp = sum(l => l.undertaken?.expected.total ?? 0);
  const und_act = sum(l => l.undertaken?.actual ?? 0);
  const subA = zeroKeys(), subI = zeroKeys();
  for (const l of rows) for (const k of ACTIVITY_KEYS) { subA[k] += l.activities[k]; subI[k] += l.ideal[k]; }
  const community = rows.filter(l => !l.is_nurse);
  const nurses = rows.filter(l => l.is_nurse);
  const by_type = Object.fromEntries(ADOPTION_TYPES.map(t => [t, typeAgg(community, t)])) as Record<AdoptionType, TypeAgg>;
  return {
    key, label,
    learners: rows.length,
    nurses: nurses.length,
    adoptions, target, fulfilment_pct: pct(adoptions, target),
    activities, ideal, intensity_pct: pct(activities, ideal),
    undertaken_expected: und_exp, undertaken_actual: und_act, undertaken_pct: pct(und_act, und_exp),
    subtype_actual: subA, subtype_ideal: subI,
    subtype_pct: Object.fromEntries(ACTIVITY_KEYS.map(k => [k, pct(subA[k], subI[k])])) as Record<ActivityKey, number | null>,
    by_type,
    nurse_lt5: typeAgg(nurses, 'pnc_lt5'),
    nil: quartiles(rows.map(l => l.nil_days).filter((d): d is number => d != null)),
    zero_adoptions: rows.filter(l => l.adoptions.total === 0).length,
    adopted_no_activity: rows.filter(l => l.adoptions.total > 0 && l.activities.total === 0).length,
  };
}

/** One aggregate per group of `dim`, in order. */
export function splitBy(rows: MasdLearner[], dim: MasdDim): MasdAgg[] {
  return groupsOf(rows, dim).map(g => aggregate(rows.filter(l => groupOf(l, dim) === g), g, g));
}

/** Exclusions and retention for any learner groups, from each learner's dyads. */
export interface OutcomeAgg {
  key: string;
  label: string;
  learners: number;
  learnersFinal: number;
  eligible: number;
  included: number;
  reasons: Record<string, number>;
}

export function outcomeSplit(rows: MasdLearner[], outcomes: MasdOutcomes, dim: MasdDim): OutcomeAgg[] {
  const per = outcomes.by_learner ?? {};
  const make = (list: MasdLearner[], key: string): OutcomeAgg => {
    const out: OutcomeAgg = { key, label: key, learners: 0, learnersFinal: 0, eligible: 0, included: 0, reasons: {} };
    for (const l of list) {
      const e = per[String(l.id)];
      if (!e) continue;
      // As the server's retention: learners with at least one eligible dyad.
      out.learners += 1;
      out.eligible += e.eligible;
      out.included += e.included;
      if (e.included > 0) out.learnersFinal += 1;
      for (const [r, n] of Object.entries(e.reasons)) out.reasons[r] = (out.reasons[r] ?? 0) + n;
    }
    return out;
  };
  return [...groupsOf(rows, dim).map(g => make(rows.filter(l => groupOf(l, dim) === g), g)), make(rows, 'Total')];
}

/** The learners an outcome table speaks for: F2F learners who are not Staff
 *  Nurses (as the server's outcome funnel). */
export const outcomeLearners = (report: MasdReport) => report.learners.filter(l => l.f2f && !l.is_nurse);

/** Whether any group of any dimension is ticked. */
export const filtersActive = (filters: MasdFilters) => Object.values(filters).some(v => (v?.length ?? 0) > 0);

/** The learner IDs the filters keep, or null when nothing is filtered. */
export const filteredIds = (rows: MasdLearner[], filters: MasdFilters): number[] | null =>
  (filtersActive(filters) ? applyFilters(rows, filters).map(l => l.id) : null);

// ── Uptake, recounted for any group of learners (review of 12 Oct 2026) ─────

export type UptakeBucketKey = 'before' | 'd7' | 'd15' | 'd30' | 'later' | 'not_yet';
export const UPTAKE_KEYS: UptakeBucketKey[] = ['before', 'd7', 'd15', 'd30', 'later', 'not_yet'];

export const uptakeBucket = (days: number | null | undefined): UptakeBucketKey =>
  days == null ? 'not_yet' : days <= 0 ? 'before' : days <= 7 ? 'd7' : days <= 15 ? 'd15' : days <= 30 ? 'd30' : 'later';

export interface UptakeCount {
  learners: number;
  started: number;
  completed: number;
  start: { median: number | null; q1: number | null; q3: number | null };
  complete: { median: number | null; q1: number | null; q3: number | null };
  nth: { n: number; learners: number; done: number; by: Record<UptakeBucketKey, number>;
    types: Record<AdoptionType, number>; median: number | null; q1: number | null; q3: number | null }[];
}

/** The engine's `_uptake` summary, for the learners given. */
export function uptakeFor(rows: MasdLearner[], step: number): UptakeCount {
  const recs = rows.map(l => l.uptake?.find(u => u.step === step)).filter((u): u is NonNullable<typeof u> => !!u);
  const started = recs.map(u => u.nth?.[0] ?? u.started_days).filter((d): d is number => d != null);
  const completed = recs.map(u => u.completed_days).filter((d): d is number => d != null);
  const maxN = Math.max(0, ...recs.map(u => u.asked ?? u.nth?.length ?? 0));
  const nth = [];
  for (let n = 1; n <= maxN; n++) {
    const pool = recs.filter(u => (u.nth?.length ?? 0) >= n);
    const days = pool.map(u => u.nth![n - 1]).filter((d): d is number => d != null);
    const by = Object.fromEntries(UPTAKE_KEYS.map(k => [k, 0])) as Record<UptakeBucketKey, number>;
    for (const u of pool) by[uptakeBucket(u.nth![n - 1])] += 1;
    const types = Object.fromEntries(ADOPTION_TYPES.map(t => [t, 0])) as Record<AdoptionType, number>;
    for (const u of pool) {
      const t = u.types?.[n - 1];
      if (t) types[t] += 1;
    }
    nth.push({ n, learners: pool.length, done: days.length, by, types, ...quartiles(days.map(d => Math.max(0, d))) });
  }
  return {
    learners: recs.length,
    started: started.length,
    completed: completed.length,
    start: quartiles(started.map(d => Math.max(0, d))),
    complete: quartiles(completed.map(d => Math.max(0, d))),
    nth,
  };
}

/** The three levels of expected activity for any group of learners. */
export function levelsFor(rows: MasdLearner[]) {
  const sum = (f: (l: MasdLearner) => number) => rows.reduce((a, l) => a + f(l), 0);
  const adoptions = sum(l => l.adoptions.total), target = sum(l => l.target);
  const acts = sum(l => l.activities.total), ideal = sum(l => l.ideal.total);
  const und = sum(l => l.undertaken?.expected.total ?? 0), undAct = sum(l => l.undertaken?.actual ?? 0);
  const own = sum(l => l.own.expected.total), ownAct = sum(l => l.own.actual.total);
  return {
    adoptions, target, fulfilment: pct(adoptions, target),
    activities: acts, ideal, level1: pct(acts, ideal),
    undertakenExpected: und, undertakenActual: undAct, level2: pct(undAct, und),
    ownExpected: own, ownActual: ownAct, level3: pct(ownAct, own),
    nil: quartiles(rows.map(l => l.nil_days).filter((d): d is number => d != null)),
  };
}
