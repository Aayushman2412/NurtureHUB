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

/** Why a form is on a visit (app/visit_protocol.form_reasons): the tag beside it. */
export type FormTag =
  | { kind: 'every_visit' }
  | { kind: 'count' | 'catch_up'; n: number; of: number }
  | { kind: 'until_good' | 'reopened'; n: number }
  | { kind: 'cf'; n: number }
  | { kind: 'first' | 'every_15' };

export interface NextVisit extends PlannedVisit {
  late_days: number;
  /** A visit begun today with forms still to fill. */
  unfinished: boolean;
  tags?: Partial<Record<FormCode, FormTag>>;
}

/** Whether a complementary feeding form may be filled today (app/visit_protocol.cf_gate). */
export interface CfGate {
  allowed: boolean;
  reason: null | 'done_today' | 'too_early' | 'not_started' | 'not_applicable';
  count: number;
  last_on: string | null;
  last_day: number | null;
  last_no: number | null;
  next_on: string | null;
  next_day: number | null;
  next_no: number | null;
}

export type DotState = 'done' | 'missed' | 'due' | 'next' | 'later';

/** The adoption's visits as a line of dots (app/visit_protocol.timeline). */
export interface VisitTimeline {
  lines: { key: 'anc' | 'pnc' | 'cf' | 'b3'; visits: { n: number; due_on: string; day: number; cf_no: number | null; state: DotState; done_on: string | null }[] }[];
  current: { n: number; total: number; done: number; missed: number; state: 'due' | 'next' } | null;
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
  today?: { visited: boolean; forms: FormCode[]; done: FormCode[]; pending: FormCode[]; tags?: Partial<Record<FormCode, FormTag>> };
  cf?: CfGate;
  timeline?: VisitTimeline;
  /** A batch monitor is linked to the learner ("Tell your supervisor"). */
  has_supervisor?: boolean;
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

/** A baby in danger: tell the learner's batch monitor today (once a day per baby). */
export const tellSupervisor = (childId: number): Promise<{ sent: boolean; already_today: boolean }> =>
  client.post(`/api/visits/children/${childId}/tell-supervisor`).then(r => r.data);

/** Confirm the adoption a drop-out (allowed only when the plan says so). */
export const confirmDropOut = (childId: number): Promise<ChildVisitPlan> =>
  client.post(`/api/visits/children/${childId}/drop-out`).then(r => r.data);
