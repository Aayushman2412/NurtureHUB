import client from './client';
import type { FormCode } from './today';

/** The visit protocol of Nov 2026 (docs/visit-protocol-2026-11.md, "Growth
 *  status, priority and data checks"). Backend: app/growth_priority.py,
 *  app/growth_groups.py, app/growth_entry_checks.py. */

/** 1 refer today · 2 act this week · 3 counsel at the next visit · null not flagged. */
export type Tier = 1 | 2 | 3;
export interface Priority { tier: Tier | null; score: number }

export type GrowthGroup = 'underweight' | 'faltering' | 'stunted' | 'wasted';
export const GROWTH_GROUPS: GrowthGroup[] = ['underweight', 'faltering', 'stunted', 'wasted'];
export type Grade = 'severe' | 'moderate' | 'mild' | 'normal';

export interface GrowthBaby {
  child_id: number;
  mother_id: number;
  child_name: string | null;
  mother_name: string | null;
  /** The forms of a visit at the baby's age today: what "Start visit" opens. */
  forms: FormCode[];
}

export interface WeighedBaby extends GrowthBaby {
  last_check: string;
  groups: GrowthGroup[];
  grades: { underweight: Grade | null; stunted: Grade | null; wasted: Grade | null };
  /** rule: waz (weight-for-age trend) | newborn_loss | birth_weight_not_regained | newborn */
  trend: { group: string; rule: string; since: string | null };
  priority: Priority;
  growing_well: boolean;
}

export interface MyBabiesGrowth {
  as_of: string;
  measured: number;
  not_measured: number;
  growing_well: number;
  counts: Record<GrowthGroup, number>;
  /** Most urgent first by the priority score. */
  babies: WeighedBaby[];
  unmeasured: GrowthBaby[];
}

export const getMyBabiesGrowth = (): Promise<MyBabiesGrowth> =>
  client.get('/api/growth/my-babies').then(r => r.data);

// ── Measurement checks (the growth check runner) ─────────────────────────────

export type CheckCode =
  | 'impossible_wfa' | 'impossible_lfa' | 'impossible_wfl' | 'typing_error'
  | 'weight_loss_refer' | 'weight_loss_revisit' | 'newborn_loss' | 'length_shorter';

export interface CheckFlag {
  code: CheckCode;
  field: 'weight' | 'length';
  action: 'remeasure' | 'refer_today' | 'revisit_7d' | 'remeasure_two_people';
  previous?: { on: string; value: number };
  loss_pct?: number;
  shorter_cm?: number;
  birth_weight?: number;
  revisit_within_days?: number;
}

/** What a saved growth check carries in summary_json.entry_checks. */
export interface EntryChecks {
  version: number;
  flags: CheckFlag[];
  confirmed: CheckCode[];
  all_confirmed: boolean;
}

export interface MeasurementCheck {
  flags: CheckFlag[];
  previous: { weight: { on: string; value: number } | null; length: { on: string; value: number } | null };
}

export const checkMeasurement = (
  childId: number,
  body: { assessment_date: string; weight: number | null; length: number | null; response_id: number | null },
): Promise<MeasurementCheck> =>
  client.post(`/api/growth/my-cases/${childId}/measurement-check`, body).then(r => r.data);
