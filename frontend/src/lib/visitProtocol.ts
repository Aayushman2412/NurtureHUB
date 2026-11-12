/**
 * The November 2026 visit protocol on the worker's side
 * (docs/visit-protocol-2026-11.md; the rules live in backend
 * app/visit_protocol.py). A learner's project runs either "lap_2025" (the
 * older LAP tables) or "lap_2026_11"; the user record carries which, and the
 * PNC split in days. Everything here is for "lap_2026_11" only — the older
 * protocol keeps lib/careFlow.ts exactly as it was.
 */
import type { FormCode } from '../api/today';
import type { ChildVisitPlan } from '../api/visits';
import type { FlowNode, FlowSchema } from './flowTypes';

export const NEW_PROTOCOL = 'lap_2026_11';

export const usesNewProtocol = (user: { visit_protocol?: string } | null | undefined): boolean =>
  user?.visit_protocol === NEW_PROTOCOL;

/** The baby's forms on day 0, after the child form: bucket 2 (under the
 *  split) CG → BF, bucket 3 CG → BF-1 → CF-1. The mother's protein form follows. */
export const firstBabyForms = (ageDays: number | null, splitDays: number): FormCode[] =>
  ageDays != null && ageDays >= splitDays ? ['gm', 'bf', 'cf'] : ['gm', 'bf'];

/** The forms a visit made now carries: what is left of today's, else today's. */
export const formsForNow = (plan: ChildVisitPlan): FormCode[] => {
  const today = plan.today;
  if (!today) return ['gm'];
  if (today.pending.length) return today.pending;
  return today.forms.length ? today.forms : ['gm'];
};

/** A visibility rule nothing can satisfy: the runner walks past the node. */
const NEVER = { nodeId: '__visit_protocol_hidden__', anyOf: ['__never__'] };

const verdictQuestions = (schema: FlowSchema): string[] =>
  Object.values(schema.nodes).flatMap((node: FlowNode) => {
    const questions = node.kind === 'section' ? node.children : node.kind === 'question' ? [node] : [];
    return questions.filter(q => q.options.some(o => o.verdict)).map(q => q.id);
  });

/**
 * The breastfeeding form without the points that dropped out (answered green
 * in two back-to-back forms). If that would leave no scored question at all,
 * the whole form is shown — an empty assessment helps nobody.
 */
export const withoutQuestions = (schema: FlowSchema, hidden: string[]): FlowSchema => {
  const drop = new Set(hidden);
  if (drop.size === 0) return schema;
  const scored = verdictQuestions(schema);
  if (scored.length > 0 && scored.every(id => drop.has(id))) return schema;
  const nodes: Record<string, FlowNode> = {};
  for (const [id, node] of Object.entries(schema.nodes)) {
    if (node.kind === 'section') {
      nodes[id] = { ...node, children: node.children.filter(c => !drop.has(c.id)) };
    } else if (node.kind === 'question' && drop.has(node.id)) {
      nodes[id] = { ...node, visibleIf: NEVER };
    } else {
      nodes[id] = node;
    }
  }
  return { ...schema, nodes };
};
