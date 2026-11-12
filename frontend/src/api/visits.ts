import client from './client';
import type { FormCode } from './today';

/**
 * A baby's visit plan under the November 2026 protocol — backend
 * /api/visits/children/{id} (routers/visits.py, app/visit_protocol.py).
 * On a project still on the older protocol the reply is only
 * `{ protocol: 'lap_2025', pnc_split_days }`.
 */

export interface PlannedVisit {
  due_on: string;
  forms: FormCode[];
  day: number | null;
  cf_no: number | null;
  ask_delivery: boolean;
}

export interface NextVisit extends PlannedVisit {
  late_days: number;
  /** A visit begun today with forms still to fill. */
  unfinished: boolean;
}

/** ok | counsel | counselled | can_drop_out | not_breastfeeding | not_applicable */
export type FeedingState = 'ok' | 'counsel' | 'counselled' | 'can_drop_out' | 'not_breastfeeding' | 'not_applicable';

export interface ChildVisitPlan {
  protocol: string;
  pnc_split_days: number;
  child_id?: number;
  mother_id?: number;
  bucket?: 'anc' | 'pnc_lt' | 'pnc_ge';
  phase?: 'anc' | 'pnc';
  anchor?: string | null;
  dropped_out?: boolean;
  today?: { visited: boolean; forms: FormCode[]; done: FormCode[]; pending: FormCode[] };
  next?: NextVisit | null;
  later?: PlannedVisit[];
  /** active | reopened | stopped | done | not_breastfeeding | not_applicable */
  bf?: { status: string; count: number; hidden_questions: string[] };
  pf?: { stopped: boolean; last_on: string | null; next_on: string | null };
  feeding?: { state: FeedingState; since: string | null; counselled_on: string | null; visits_after: number };
  dropout?: { on: string; reason: string | null; by: string | null } | null;
}

export const getChildVisitPlan = (childId: number): Promise<ChildVisitPlan> =>
  client.get(`/api/visits/children/${childId}`).then(r => r.data);

/** "I counselled her today to restart breastfeeding." */
export const recordCounselling = (childId: number): Promise<ChildVisitPlan> =>
  client.post(`/api/visits/children/${childId}/counselled`).then(r => r.data);

/** Confirm the adoption a drop-out (allowed only when the plan says so). */
export const confirmDropOut = (childId: number): Promise<ChildVisitPlan> =>
  client.post(`/api/visits/children/${childId}/drop-out`).then(r => r.data);
