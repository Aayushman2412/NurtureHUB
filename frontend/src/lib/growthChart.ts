/**
 * Shared helpers for the LAP growth charts (WHO percentile backgrounds +
 * per-visit series). Used by the admin Growth Monitor and the learner's
 * case-wise growth view.
 *
 * The six charts = 2 cohorts × 3 indicators (weight-for-age, length-for-age,
 * weight-for-length). The cohort is a property of the CHILD, fixed at
 * adoption — not of the individual visit:
 *
 *   - "young" → adopted before 150 days of age
 *   - "old"   → adopted at 150 days or later
 *
 * So a child adopted at 100 days stays on the young charts for their whole
 * follow-up; their visit at 200 days is plotted on the SAME young chart
 * (whose axis simply extends to fit), never moved to the old chart. One child
 * therefore appears in exactly one cohort — the two sets are never both
 * populated for the same case.
 */

import type { GrowthCase, GrowthIndicator, GrowthStandardPoint, GrowthVisit } from '../api/growth';
import { GROWTH_SOURCE_COLORS, PERCENTILE_COLORS } from '../utils/brandColors';
import { programme } from './programme';

export type GrowthCohort = 'young' | 'old';
/** The PNC adoption split (150 days unless the programme setting moves it). */
export const cohortSplitDays = () => programme.pncSplitDays;

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
  // Birth → 6 months, like the WHO birth-to-6-months chart. This is the
  // STARTING domain: a young-cohort child followed past 150 days extends it
  // (see cohortDomains) rather than moving to the old chart.
  young: { cohort: 'young', ageDomain: [0, 183], lengthDomain: [45, 70] },
  // 150 days → 2 years.
  old: { cohort: 'old', ageDomain: [150, 731], lengthDomain: [58, 100] },
};

/** Hard limits of the WHO reference tables — domains never exceed them. */
const MAX_STANDARD_AGE_DAYS = 730;
const MAX_STANDARD_LENGTH_CM = 110;

const DAYS_PER_MONTH = 30.4375;
/** The longest age axis a chart opens with: 15 months (review of 19 Oct 2026 —
 *  "24 months may not be of use to us ... reduce it to a maximum of 15
 *  months"). A child followed beyond it still stretches the axis to fit. */
export const MAX_AGE_AXIS_DAYS = Math.round(15 * DAYS_PER_MONTH);
/** Under a month at the last visit, the age axis counts days ("within one
 *  month we have 11 visits; on a monthly axis all the points are crowded"). */
const DAYS_AXIS_LIMIT = 31;

export type AgeUnit = 'days' | 'weeks' | 'months';

/** The unit an age axis counts in, from how long it is. */
export const ageUnitFor = (cohort: GrowthCohort, domain: [number, number]): AgeUnit =>
  domain[1] <= DAYS_AXIS_LIMIT ? 'days' : cohort === 'young' && domain[1] <= 200 ? 'weeks' : 'months';

/** Whole days between two ISO dates, or null when either is missing/invalid. */
const daysBetween = (fromIso: string | null, toIso: string | null): number | null => {
  if (!fromIso || !toIso) return null;
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00`).getTime();
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / 86_400_000);
};

/** The child's age in days on the day they were adopted into the program. */
export const adoptionAgeDays = (c: GrowthCase): number | null =>
  daysBetween(c.child.dob ?? null, c.child.adoption_date ?? null);

/**
 * Which cohort a CASE belongs to — decided once, by age at adoption.
 *
 * Fallback when adoption date or DOB is missing: the child's age at their
 * earliest recorded visit, which is the closest proxy for when they entered
 * the programme. With nothing at all to go on, they sit in the young cohort
 * (where the birth record is also plotted).
 */
export const adoptionCohort = (c: GrowthCase): GrowthCohort => {
  const atAdoption = adoptionAgeDays(c);
  if (atAdoption != null && atAdoption >= 0) {
    return atAdoption < cohortSplitDays() ? 'young' : 'old';
  }
  const ages = c.visits.map(v => v.age_days).filter((a): a is number => a != null && a >= 0);
  if (ages.length > 0) return Math.min(...ages) < cohortSplitDays() ? 'young' : 'old';
  return 'young';
};

/** Does this case belong to the given cohort? */
export const caseInCohort = (c: GrowthCase, cohort: GrowthCohort): boolean =>
  adoptionCohort(c) === cohort;

/**
 * Axis domains for a cohort's charts, fitted to the plotted cases (review of
 * 19 Oct 2026: "can this x-axis get auto-adjusted based on the last visit?").
 *
 * The age axis runs to just past the latest visit: in days while that is
 * under a month (a staff nurse's cases span 10-15 days), in weeks up to about
 * six months, in months beyond — and never past 15 months unless a child is
 * followed longer. The length axis spans the measured lengths. Without
 * visits, the cohort's standard window.
 */
export const cohortDomains = (
  cohort: GrowthCohort,
  cases: GrowthCase[],
): { ageDomain: [number, number]; lengthDomain: [number, number] } => {
  const spec = COHORT_SPECS[cohort];
  let maxAge = -1;
  let minAge = Infinity;
  let maxLength = -Infinity;
  let minLength = Infinity;

  for (const c of cases) {
    if (!caseInCohort(c, cohort)) continue;
    for (const v of c.visits) {
      if (v.age_days != null && v.age_days >= 0 && (v.weight != null || v.length != null)) {
        maxAge = Math.max(maxAge, v.age_days);
        minAge = Math.min(minAge, v.age_days);
      }
      if (v.length != null) {
        maxLength = Math.max(maxLength, v.length);
        minLength = Math.min(minLength, v.length);
      }
    }
    if (cohort === 'young' && c.child.birth_length != null) {
      maxLength = Math.max(maxLength, c.child.birth_length);
      minLength = Math.min(minLength, c.child.birth_length);
    }
    if (cohort === 'young' && (c.child.birth_weight != null || c.child.birth_length != null)) {
      maxAge = Math.max(maxAge, 0);
      minAge = Math.min(minAge, 0);
    }
  }

  let ageDomain: [number, number] = [spec.ageDomain[0], Math.min(spec.ageDomain[1], MAX_AGE_AXIS_DAYS)];
  if (maxAge >= 0) {
    const cap = maxAge > MAX_AGE_AXIS_DAYS ? MAX_STANDARD_AGE_DAYS : MAX_AGE_AXIS_DAYS;
    if (cohort === 'young') {
      const hi = maxAge <= 30
        ? Math.min(DAYS_AXIS_LIMIT, Math.max(10, Math.ceil((maxAge + 2) / 5) * 5))  // days
        : maxAge < 180
          ? Math.max(42, Math.ceil((maxAge + 7) / 14) * 14)              // weeks
          : Math.ceil((maxAge + 14) / DAYS_PER_MONTH) * DAYS_PER_MONTH;  // months
      ageDomain = [0, Math.min(cap, hi)];
    } else {
      const lo = Math.max(4 * DAYS_PER_MONTH, Math.floor((minAge - 14) / DAYS_PER_MONTH) * DAYS_PER_MONTH);
      const hi = Math.max(lo + 2 * DAYS_PER_MONTH, Math.ceil((maxAge + 14) / DAYS_PER_MONTH) * DAYS_PER_MONTH);
      ageDomain = [Math.min(lo, spec.ageDomain[0]), Math.min(cap, hi)];
    }
  }

  let lengthDomain: [number, number] = spec.lengthDomain;
  if (Number.isFinite(minLength)) {
    const lo = Math.max(45, Math.floor((minLength - 2) / 5) * 5);
    const hi = Math.min(MAX_STANDARD_LENGTH_CM, Math.max(lo + 15, Math.ceil((maxLength + 3) / 5) * 5));
    lengthDomain = [lo, hi];
  }
  return { ageDomain, lengthDomain };
};

/**
 * Build the plottable series of one case for a given chart.
 *
 * The case's cohort (age at adoption) decides which chart it appears on;
 * once it is on that chart EVERY visit is plotted, however old the child has
 * since become. Includes a synthesized birth-record point (age 0) from the
 * child registration for young-cohort cases with birth metrics.
 */
export const buildSeries = (
  c: GrowthCase,
  indicator: GrowthIndicator,
  cohort: GrowthCohort,
): GrowthSeries => {
  const points: GrowthPoint[] = [];
  if (!caseInCohort(c, cohort)) return { caseId: c.child.id, points };

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
    if (v.age_days == null || v.age_days < 0) continue;
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

/** Does this case have anything to draw in this cohort (any indicator)?
 *  False for the cohort the case does not belong to — a child is only ever
 *  charted in their adoption cohort. */
export const caseHasCohortData = (c: GrowthCase, cohort: GrowthCohort): boolean => {
  if (!caseInCohort(c, cohort)) return false;
  return (
    c.visits.some(
      v => v.age_days != null && v.age_days >= 0 && (v.weight != null || v.length != null),
    ) ||
    (cohort === 'young' && (c.child.birth_weight != null || c.child.birth_length != null))
  );
};

/** Sex of the WHO reference tables for a child's gender (null → no chart). */
export const sexKeyForGender = (gender: string | null): 'boys' | 'girls' | null => {
  if (gender === 'Male') return 'boys';
  if (gender === 'Female') return 'girls';
  return null;
};

/**
 * X-axis ticks across the ACTUAL domain, in the unit ageUnitFor picks: days
 * for a chart under a month long, weeks up to about six months, months after.
 */
export const ageTicks = (
  cohort: GrowthCohort,
  domain?: [number, number],
): { value: number; label: string }[] => {
  const [lo, hi] = domain ?? COHORT_SPECS[cohort].ageDomain;
  const unit = ageUnitFor(cohort, [lo, hi]);
  const ticks: { value: number; label: string }[] = [];
  if (unit === 'days') {
    const step = hi <= 15 ? 1 : 2;
    for (let d = Math.ceil(lo / step) * step; d <= hi; d += step) ticks.push({ value: d, label: `${d}` });
    return ticks;
  }
  if (unit === 'weeks') {
    const every = hi / 7 > 16 ? 2 : 1;
    for (let w = Math.ceil(lo / 7); w * 7 <= hi; w += 1) {
      ticks.push({ value: w * 7, label: w % every === 0 ? `${w}` : '' });
    }
    return ticks;
  }
  // Month ticks; label every other one when the span is long.
  const startMonth = Math.floor(lo / DAYS_PER_MONTH);
  const endMonth = Math.ceil(hi / DAYS_PER_MONTH);
  const dense = endMonth - startMonth > 14;
  for (let m = startMonth; m <= endMonth; m += 1) {
    const value = m * DAYS_PER_MONTH;
    if (value < lo || value > hi) continue;
    ticks.push({ value, label: !dense || m % 2 === (startMonth % 2) ? `${m}` : '' });
  }
  return ticks;
};

export const lengthTicks = (
  cohort: GrowthCohort,
  domain?: [number, number],
): { value: number; label: string }[] => {
  const [lo, hi] = domain ?? COHORT_SPECS[cohort].lengthDomain;
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
