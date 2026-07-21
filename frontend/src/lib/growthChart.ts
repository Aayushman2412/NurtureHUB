/**
 * Shared helpers for the LAP growth charts (WHO percentile backgrounds +
 * per-visit series). Used by the admin Growth Monitor and the learner's
 * case-wise growth view.
 *
 * The six charts = 2 age cohorts × 3 indicators:
 *   - "young"  → visits before 150 days of age (breastfeeding phase)
 *   - "old"    → visits at 150 days and older (complementary-feeding phase)
 *   - indicators: weight-for-age, length-for-age, weight-for-length
 */

import type { GrowthCase, GrowthIndicator, GrowthStandardPoint, GrowthVisit } from '../api/growth';
import { GROWTH_SOURCE_COLORS, PERCENTILE_COLORS } from '../utils/brandColors';

export type GrowthCohort = 'young' | 'old';
export const COHORT_SPLIT_DAYS = 150;

/** How a visit's metrics were collected → its color on the charts. */
export type VisitSourceCombo = 'birth' | 'growth' | 'growth_bf' | 'growth_cf' | 'growth_bf_cf';

export const PERCENTILE_KEYS = ['p3', 'p15', 'p50', 'p85', 'p97'] as const;
export type PercentileKey = (typeof PERCENTILE_KEYS)[number];

export const percentileColor = (key: PercentileKey): string => PERCENTILE_COLORS[key];
export const sourceComboColor = (combo: VisitSourceCombo): string => GROWTH_SOURCE_COLORS[combo];

export const visitSourceCombo = (sources: string[]): VisitSourceCombo => {
  const bf = sources.includes('breastfeeding');
  const cf = sources.includes('complementary_feeding');
  if (bf && cf) return 'growth_bf_cf';
  if (bf) return 'growth_bf';
  if (cf) return 'growth_cf';
  return 'growth';
};

/** One plottable point on a chart, carrying everything the tooltip shows. */
export interface GrowthPoint {
  x: number;
  y: number;
  combo: VisitSourceCombo;
  case: GrowthCase;
  /** null for the synthesized birth-record point. */
  visit: GrowthVisit | null;
}

/** A case's polyline on one chart (points sorted by x). */
export interface GrowthSeries {
  caseId: number;
  points: GrowthPoint[];
}

export interface CohortSpec {
  cohort: GrowthCohort;
  /** x-domain per indicator: age in days (wfa/lfa) or length in cm (wfl). */
  ageDomain: [number, number];
  lengthDomain: [number, number];
}

export const COHORT_SPECS: Record<GrowthCohort, CohortSpec> = {
  // Birth → 6 months, like the WHO birth-to-6-months chart; only visits
  // before 150 days actually land here.
  young: { cohort: 'young', ageDomain: [0, 183], lengthDomain: [45, 70] },
  // 150 days → 2 years.
  old: { cohort: 'old', ageDomain: [COHORT_SPLIT_DAYS, 731], lengthDomain: [58, 100] },
};

const inCohort = (ageDays: number, cohort: GrowthCohort): boolean =>
  cohort === 'young' ? ageDays < COHORT_SPLIT_DAYS : ageDays >= COHORT_SPLIT_DAYS;

/**
 * Build the plottable series of one case for a given chart. Includes a
 * synthesized birth-record point (age 0) from the child registration when the
 * chart is the young cohort and the birth metrics exist.
 */
export const buildSeries = (
  c: GrowthCase,
  indicator: GrowthIndicator,
  cohort: GrowthCohort,
): GrowthSeries => {
  const points: GrowthPoint[] = [];

  if (cohort === 'young') {
    const bw = c.child.birth_weight;
    const bl = c.child.birth_length;
    if (indicator === 'wfa' && bw != null) {
      points.push({ x: 0, y: bw, combo: 'birth', case: c, visit: null });
    } else if (indicator === 'lfa' && bl != null) {
      points.push({ x: 0, y: bl, combo: 'birth', case: c, visit: null });
    } else if (indicator === 'wfl' && bw != null && bl != null) {
      points.push({ x: bl, y: bw, combo: 'birth', case: c, visit: null });
    }
  }

  for (const v of c.visits) {
    if (v.age_days == null || v.age_days < 0 || !inCohort(v.age_days, cohort)) continue;
    const combo = visitSourceCombo(v.sources);
    if (indicator === 'wfa' && v.weight != null) {
      points.push({ x: v.age_days, y: v.weight, combo, case: c, visit: v });
    } else if (indicator === 'lfa' && v.length != null) {
      points.push({ x: v.age_days, y: v.length, combo, case: c, visit: v });
    } else if (indicator === 'wfl' && v.weight != null && v.length != null) {
      points.push({ x: v.length, y: v.weight, combo, case: c, visit: v });
    }
  }

  points.sort((a, b) => a.x - b.x);
  return { caseId: c.child.id, points };
};

/** Does this case have anything to draw in this cohort (any indicator)? */
export const caseHasCohortData = (c: GrowthCase, cohort: GrowthCohort): boolean =>
  c.visits.some(
    v =>
      v.age_days != null &&
      v.age_days >= 0 &&
      inCohort(v.age_days, cohort) &&
      (v.weight != null || v.length != null),
  ) ||
  (cohort === 'young' && (c.child.birth_weight != null || c.child.birth_length != null));

/** Sex of the WHO reference tables for a child's gender (null → no chart). */
export const sexKeyForGender = (gender: string | null): 'boys' | 'girls' | null => {
  if (gender === 'Male') return 'boys';
  if (gender === 'Female') return 'girls';
  return null;
};

const DAYS_PER_MONTH = 30.4375;

/** X-axis ticks: weeks for the young age axis, months for the old one. */
export const ageTicks = (cohort: GrowthCohort): { value: number; label: string }[] => {
  if (cohort === 'young') {
    const ticks = [];
    for (let w = 0; w <= 26; w += 2) ticks.push({ value: w * 7, label: `${w}` });
    return ticks;
  }
  const ticks = [];
  for (let m = 5; m <= 24; m += 1) {
    ticks.push({ value: m * DAYS_PER_MONTH, label: m % 2 === 1 ? `${m}` : '' });
  }
  return ticks;
};

export const lengthTicks = (cohort: GrowthCohort): { value: number; label: string }[] => {
  const [lo, hi] = COHORT_SPECS[cohort].lengthDomain;
  const ticks = [];
  for (let v = lo; v <= hi; v += 5) ticks.push({ value: v, label: `${v}` });
  return ticks;
};

/** Trim percentile rows to a domain (keeping one point beyond each edge so the
 * curves reach the chart borders). */
export const clipStandards = (
  rows: GrowthStandardPoint[],
  domain: [number, number],
): GrowthStandardPoint[] => {
  const inside = rows.filter(r => r.x >= domain[0] && r.x <= domain[1]);
  const before = rows.filter(r => r.x < domain[0]).slice(-1);
  const after = rows.filter(r => r.x > domain[1]).slice(0, 1);
  return [...before, ...inside, ...after];
};

/** Format an age in days for tooltips: "12 d", "6 wk", "8 mo". */
export const formatAge = (ageDays: number): string => {
  if (ageDays < 14) return `${ageDays} d`;
  if (ageDays < 98) {
    const weeks = Math.round(ageDays / 7);
    return `${weeks} wk`;
  }
  const months = ageDays / DAYS_PER_MONTH;
  const rounded = Math.round(months * 2) / 2;
  return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} mo`;
};
