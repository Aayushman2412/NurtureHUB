/**
 * Pure helpers for the learner-facing assessment runner & related pages.
 *
 * The runner never keeps a manual step stack: the visible path is DERIVED by
 * replaying the answers map over the flow graph from `startNodeId`. Editing an
 * earlier answer therefore re-derives the downstream path automatically, and
 * stale answers (nodes no longer on the path) are simply excluded when the
 * final payload is built.
 */

import axios from 'axios';
import type {
  AnswerIn,
  FlowInfoNode,
  FlowMatrixNode,
  FlowQuestionNode,
  FlowSchema,
  FlowSectionChild,
  MatrixRow,
} from '../../lib/flowTypes';
import {
  isInfoNode,
  isMatrixNode,
  isSectionNode,
  parseMatrixAnswer,
  visibleIfSatisfied,
} from '../../lib/flowTypes';
import { nextNodeId } from '../../lib/flowGraph';

// ── Answer state ─────────────────────────────────────────────────────────────

export interface AnswerState {
  optionIds: string[];
  /** For number questions the raw numeric string; for matrix nodes the
   *  JSON-encoded per-cell map (see parseMatrixAnswer); else free text. */
  value: string;
}

/** questionId → answer (section children keyed by their own child id). */
export type AnswersMap = Record<string, AnswerState>;

/**
 * One screen of the runner. Most steps are questions; a flow may also contain
 * non-answerable info blocks and multi-dropdown matrix grids.
 */
export type PathStep =
  | {
      kind: 'question';
      id: string;
      sectionId: string | null;
      sectionTitle: string | null;
      question: FlowQuestionNode | FlowSectionChild;
      /** Info blocks directly preceding this step — shown above it on the same screen. */
      preamble?: FlowInfoNode[];
    }
  | { kind: 'info'; id: string; sectionId: null; sectionTitle: null; info: FlowInfoNode }
  | {
      kind: 'matrix';
      id: string;
      sectionId: null;
      sectionTitle: null;
      matrix: FlowMatrixNode;
      /** Info blocks directly preceding this step — shown above it on the same screen. */
      preamble?: FlowInfoNode[];
    };

export interface DerivedPath {
  steps: PathStep[];
  /** True when the walk reached the end of the tree (`next = null`). */
  complete: boolean;
}

/** Today's LOCAL date as ISO — toISOString() would give the UTC date, which is
 *  yesterday for IST users between midnight and 05:30. */
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function isAnswered(
  q: FlowQuestionNode | FlowSectionChild,
  a: AnswerState | undefined,
): boolean {
  if (!a) return false;
  if (q.questionType === 'single' || q.questionType === 'multi') return a.optionIds.length > 0;
  return a.value.trim().length > 0;
}

/**
 * The rows of a matrix that are currently on screen. A row carrying `visibleIf`
 * is shown only while the referenced question's answer includes one of its
 * option ids — that is what narrows the supplement grid to the supplements the
 * mother actually said she takes.
 */
export function visibleMatrixRows(m: FlowMatrixNode, answers: AnswersMap): MatrixRow[] {
  return m.rows.filter(row =>
    visibleIfSatisfied(row.visibleIf, answers[row.visibleIf?.nodeId ?? '']?.optionIds),
  );
}

/** A matrix is "answered" when every required cell of every VISIBLE row has a
 *  value. Required cells = columns explicitly marked required; if none are but
 *  the matrix node itself is required, every column is required (so the
 *  node-level toggle is never a silent no-op). */
export function isMatrixAnswered(
  m: FlowMatrixNode,
  a: AnswerState | undefined,
  answers: AnswersMap,
): boolean {
  let requiredCols = m.columns.filter(c => c.required);
  if (requiredCols.length === 0) {
    if (!m.required) return true;
    requiredCols = m.columns;
  }
  if (requiredCols.length === 0) return true;
  const grid = parseMatrixAnswer(a?.value);
  return visibleMatrixRows(m, answers).every(row =>
    requiredCols.every(col => (grid[row.id]?.[col.id] ?? '').toString().trim().length > 0),
  );
}

/** Whether a step is "answered"/passable — info blocks always are. */
export function isStepAnswered(step: PathStep, answers: AnswersMap): boolean {
  if (step.kind === 'info') return true;
  if (step.kind === 'matrix') return isMatrixAnswered(step.matrix, answers[step.id], answers);
  return isAnswered(step.question, answers[step.id]);
}

/** Does this step block forward progress until answered? */
const stepBlocks = (step: PathStep, answers: AnswersMap): boolean => {
  if (step.kind === 'info') return false;
  if (step.kind === 'matrix') {
    return step.matrix.required && !isMatrixAnswered(step.matrix, answers[step.id], answers);
  }
  return step.question.required && !isAnswered(step.question, answers[step.id]);
};

/**
 * Replay the answers over the graph. Emits one step per answerable question /
 * matrix in visit order and stops at the first unanswered *required* step (the
 * frontier) or at the end of the tree. Info blocks are buffered and attached as
 * the `preamble` of the next answerable step so they share its screen; only a
 * trailing info block (nothing answerable after it) keeps its own step. Cycles
 * and dangling `next` pointers are treated as the end so the learner is never
 * dead-locked.
 */
export function derivePath(schema: FlowSchema, answers: AnswersMap): DerivedPath {
  const steps: PathStep[] = [];
  const visited = new Set<string>();
  let currentId: string | null = schema.startNodeId;
  let complete = currentId == null;
  let pendingInfos: FlowInfoNode[] = [];
  const takePreamble = (): FlowInfoNode[] | undefined => {
    if (pendingInfos.length === 0) return undefined;
    const taken = pendingInfos;
    pendingInfos = [];
    return taken;
  };

  while (currentId) {
    if (visited.has(currentId)) {
      complete = true; // cycle guard — each node at most once
      break;
    }
    visited.add(currentId);
    const node = schema.nodes[currentId];
    if (!node) {
      complete = true; // dangling pointer — treat as end
      break;
    }

    // Answer-gated node (e.g. egg/meat food groups for a vegetarian mother):
    // walk straight through to its `next` without emitting a step. Branch
    // targets that land on a hidden node fall through the same way.
    if (!visibleIfSatisfied(node.visibleIf, answers[node.visibleIf?.nodeId ?? '']?.optionIds)) {
      currentId = node.next;
      if (currentId == null) complete = true;
      continue;
    }

    if (isSectionNode(node)) {
      const preamble = takePreamble();
      let blocked = false;
      for (let ci = 0; ci < node.children.length; ci++) {
        const child = node.children[ci];
        const step: PathStep = {
          kind: 'question',
          id: child.id,
          sectionId: node.id,
          sectionTitle: node.title,
          question: child,
          preamble: ci === 0 ? preamble : undefined,
        };
        steps.push(step);
        if (stepBlocks(step, answers)) {
          blocked = true;
          break;
        }
      }
      if (blocked) break; // frontier inside the section
      currentId = node.next;
    } else if (isInfoNode(node)) {
      pendingInfos.push(node); // rides along as the next answerable step's preamble
      currentId = node.next;
    } else if (isMatrixNode(node)) {
      const step: PathStep = {
        kind: 'matrix',
        id: node.id,
        sectionId: null,
        sectionTitle: null,
        matrix: node,
        preamble: takePreamble(),
      };
      steps.push(step);
      if (stepBlocks(step, answers)) break; // frontier
      currentId = node.next;
    } else {
      const step: PathStep = {
        kind: 'question',
        id: node.id,
        sectionId: null,
        sectionTitle: null,
        question: node,
        preamble: takePreamble(),
      };
      steps.push(step);
      if (stepBlocks(step, answers)) break; // frontier
      currentId = nextNodeId(node, answers[node.id]?.optionIds ?? []);
    }
    if (currentId == null) complete = true;
  }

  // Walk exited with infos still buffered (cycle guard, dangling pointer or
  // natural end): a trailing info block keeps its own screen.
  for (const info of pendingInfos) {
    steps.push({ kind: 'info', id: info.id, sectionId: null, sectionTitle: null, info });
  }

  return { steps, complete };
}

/** Answers payload built ONLY from answered steps on the derived path. Info
 *  steps carry no answer; matrix + number/text/date steps encode into `value`. */
export function buildAnswersPayload(steps: PathStep[], answers: AnswersMap): AnswerIn[] {
  const out: AnswerIn[] = [];
  for (const s of steps) {
    if (s.kind === 'info') continue;
    const a = answers[s.id];
    if (!a) continue;
    if (s.kind === 'matrix') {
      const grid = parseMatrixAnswer(a.value);
      // Drop cells belonging to rows that are no longer shown (the mother
      // de-selected that supplement) — the same rule that keeps answers to
      // hidden nodes out of the payload.
      const visibleIds = new Set(visibleMatrixRows(s.matrix, answers).map(r => r.id));
      const pruned = Object.fromEntries(
        Object.entries(grid).filter(([rowId]) => visibleIds.has(rowId)),
      );
      if (Object.keys(pruned).length === 0) continue;
      out.push({ nodeId: s.id, sectionId: null, optionIds: [], value: JSON.stringify(pruned) });
      continue;
    }
    if (!isAnswered(s.question, a)) continue;
    out.push({
      nodeId: s.id,
      sectionId: s.sectionId,
      optionIds: a.optionIds,
      value: a.value.trim() ? a.value : null,
    });
  }
  return out;
}

/**
 * The assessment date: the flow's OPENING date question (step 1), else today.
 * Mid-flow date questions (e.g. "when did the baby first receive solids?") are
 * deliberately ignored — they answer their own question, not when this
 * assessment happened.
 */
export function pathAssessmentDate(steps: PathStep[], answers: AnswersMap): string {
  const first = steps.find(s => s.kind === 'question');
  if (first && first.kind === 'question' && first.question.questionType === 'date') {
    const v = answers[first.id]?.value.trim();
    if (v) return v;
  }
  return todayIso();
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** ISO date → localized "18 Jul 2026" (or Hindi equivalent). */
export function formatDisplayDate(iso: string | null | undefined, language: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = language.startsWith('hi') ? 'hi-IN' : 'en-IN';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole days since an ISO date of birth; null when unknown/invalid. */
export function ageInDays(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(`${dob.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/** Human-readable API error (FastAPI `detail` string), else null. */
export function apiErrorMessage(err: unknown): string | null {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { detail?: unknown } | undefined;
    if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail;
  }
  return null;
}
