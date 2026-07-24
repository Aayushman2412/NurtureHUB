/**
 * Shared constants + tiny helpers for the admin canvas flow builder.
 * Pure data/functions only — no React.
 */

import type { FlowIssue } from '../../lib/flowGraph';
import type {
  FlowAction,
  FlowNode,
  FlowQuestionNode,
  FlowSchema,
  FlowSectionChild,
  MatrixColumn,
  MatrixRow,
  QuestionType,
  Verdict,
  VerdictDef,
  VisibleIf,
} from '../../lib/flowTypes';
import { findVerdict, resolveVerdicts } from '../../lib/flowTypes';

/** Canvas node card width (px, world units). */
export const NODE_W = 260;
/** Node positions snap to this grid (px). */
export const GRID = 8;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 1.75;
/** Fallback height for edge anchors until a card reports its measured height. */
export const DEFAULT_NODE_H = 100;

/** Sentinel value used by target pickers to mean "end of form" (`next = null`). */
export const END_TARGET = '__end__';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Single choice',
  multi: 'Multiple choice',
  text: 'Text answer',
  date: 'Date answer',
  number: 'Numerical answer',
};

/**
 * Edge / verdict colors. Emerald & rose are literal hexes (the brand theme has
 * no ramp for them and they read identically in both modes); the theme-aware
 * ones are CSS variables so dark mode flips automatically.
 */
export const EDGE_COLORS = {
  default: 'var(--color-ink-faint)',
  green: '#10b981', // emerald-500
  red: '#f43f5e', // rose-500
  neutral: 'var(--color-coral-400)',
} as const;

/**
 * Colour for a verdict. `defs` come from the form (custom verdicts carry their
 * own colour); omitting them falls back to the built-in green/red so callers
 * that have no schema handy still render sensibly.
 */
export const verdictEdgeColor = (v: Verdict, defs?: VerdictDef[]): string => {
  const def = findVerdict(resolveVerdicts(defs), v);
  if (def) return def.color;
  return EDGE_COLORS.neutral;
};

export const nodeTitle = (node: FlowNode | FlowSectionChild | undefined): string =>
  node && node.title.trim() ? node.title.trim() : 'Untitled';

export const truncate = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;

export interface TargetOption {
  value: string;
  label: string;
}

/** Every node except `excludeId`, as options for a target picker. */
export function targetOptionsFor(schema: FlowSchema, excludeId: string | null): TargetOption[] {
  return Object.values(schema.nodes)
    .filter(n => n.id !== excludeId)
    .map(n => ({
      value: n.id,
      label: `${n.kind === 'section' ? '[Section] ' : ''}${truncate(nodeTitle(n), 48)}`,
    }));
}

export const issueCounts = (issues: FlowIssue[]) => ({
  errors: issues.filter(i => i.level === 'error').length,
  warnings: issues.filter(i => i.level === 'warning').length,
});

/**
 * A pending click-to-connect request: the node (and, for a single-select
 * branch, the option) whose target the next canvas click will set.
 * `optionId === null` targets the node's default `next`.
 */
export interface ConnectRequest {
  nodeId: string;
  optionId: string | null;
}

/** Patch of the fields shared by top-level questions and section children. */
export type QuestionPatch = Partial<
  Pick<
    FlowQuestionNode,
    'title' | 'helpText' | 'required' | 'questionType' | 'options' | 'media' | 'numeric' | 'display'
  >
>;

/** Patch of any editable node field (question / section / info / matrix). */
export type NodePatch = QuestionPatch &
  Partial<Pick<FlowQuestionNode, 'next'>> & {
    children?: FlowSectionChild[];
    /** info block (media is already covered by QuestionPatch) */
    body?: string;
    action?: FlowAction;
    /** matrix */
    rows?: MatrixRow[];
    columns?: MatrixColumn[];
    /** answer-dependent visibility (all node kinds) */
    visibleIf?: VisibleIf | null;
  };
