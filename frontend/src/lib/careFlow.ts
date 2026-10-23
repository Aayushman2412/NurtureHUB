/**
 * Guided runs of forms, one after another (launch review of 19 Oct 2026).
 *
 * Dr Rupal: "make it more like one after another — that process needs to be
 * completed and then you submit"; "once they register the mother the protein
 * form will come automatically"; "as soon as the age comes, as per the LAP
 * protocol" the baby's forms follow. The worker never looks for a form.
 *
 * A flow travels in the URL as `?flow=<kind>.<next>.<next>…`:
 *   kind  — `reg` (registering a mother, then her baby) or `visit` (a visit
 *           started from Today)
 *   next  — what comes after the current step: a form code (gm, bf, cf, anc,
 *           protein) or `baby` (register the baby).
 * After the last step the worker lands on the baby's page (or the mother's).
 */
import { formRunUrl, type FormCode } from '../api/today';

const CODES = new Set(['gm', 'bf', 'cf', 'anc', 'protein', 'baby']);

/** Below this age a baby's visit carries the breastfeeding form, from it the
 *  complementary feeding one (the LAP protocol: rules.py BF_UNTIL / CF_FIRST). */
export const BF_UNTIL_DAYS = 195;

export interface Flow {
  kind: 'reg' | 'visit';
  rest: string[];
}

export const parseFlow = (raw: string | null | undefined): Flow | null => {
  if (!raw) return null;
  const [kind, ...rest] = raw.split('.');
  if (kind !== 'reg' && kind !== 'visit') return null;
  return { kind, rest: rest.filter(s => CODES.has(s)) };
};

export const flowString = (kind: Flow['kind'], rest: string[]) => [kind, ...rest].join('.');

/** The forms of a baby's visit at this age: a growth check, then breastfeeding
 *  or complementary feeding. */
export const babyVisitForms = (ageDays: number | null): FormCode[] =>
  ['gm', ageDays != null && ageDays >= BF_UNTIL_DAYS ? 'cf' : 'bf'];

/** Where the worker goes once the flow has nothing left. */
export const flowEnd = (motherId: number, childId: number | null) =>
  childId != null ? `/babies/${childId}?done=1` : `/mothers/${motherId}?done=1`;

/** The URL of the step after the current one, or the end of the flow. */
export const nextInFlow = (flow: Flow | null, motherId: number, childId: number | null): string => {
  if (!flow || flow.rest.length === 0) return flowEnd(motherId, childId);
  const [next, ...after] = flow.rest;
  if (next === 'baby') return `/mothers/${motherId}/children/new?flow=${flowString(flow.kind, after)}`;
  return formRunUrl(next as FormCode, motherId, childId, flowString(flow.kind, after));
};

/** After a growth check the chart opens at once (Dr Rupal: "as soon as they put
 *  in the weight and height it should just pop up as a growth chart") — and
 *  carries the rest of the flow so the worker can continue from there. */
export const afterGrowthCheck = (childId: number, flow: Flow | null) =>
  `/babies/${childId}?saved=gm${flow ? `&flow=${flowString(flow.kind, flow.rest)}` : ''}`;
