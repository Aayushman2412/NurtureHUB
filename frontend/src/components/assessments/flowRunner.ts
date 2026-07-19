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
  FlowQuestionNode,
  FlowSchema,
  FlowSectionChild,
} from '../../lib/flowTypes';
import { isSectionNode } from '../../lib/flowTypes';
import { nextNodeId } from '../../lib/flowGraph';

// ── Answer state ─────────────────────────────────────────────────────────────

export interface AnswerState {
  optionIds: string[];
  value: string;
}

/** questionId → answer (section children keyed by their own child id). */
export type AnswersMap = Record<string, AnswerState>;

export interface PathStep {
  /** The question id — unique per step (child id for section children). */
  id: string;
  /** Owning common-section node id, when the question lives inside one. */
  sectionId: string | null;
  sectionTitle: string | null;
  question: FlowQuestionNode | FlowSectionChild;
}

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
 * Replay the answers over the graph. Emits one step per answerable question in
 * visit order and stops at the first unanswered *required* question (the
 * frontier) or at the end of the tree. Cycles and dangling `next` pointers are
 * treated as the end of the form so the learner is never dead-locked.
 */
export function derivePath(schema: FlowSchema, answers: AnswersMap): DerivedPath {
  const steps: PathStep[] = [];
  const visited = new Set<string>();
  let currentId: string | null = schema.startNodeId;
  let complete = currentId == null;

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

    if (isSectionNode(node)) {
      let blocked = false;
      for (const child of node.children) {
        steps.push({ id: child.id, sectionId: node.id, sectionTitle: node.title, question: child });
        if (child.required && !isAnswered(child, answers[child.id])) {
          blocked = true;
          break;
        }
      }
      if (blocked) break; // frontier inside the section
      currentId = node.next;
    } else {
      steps.push({ id: node.id, sectionId: null, sectionTitle: null, question: node });
      if (node.required && !isAnswered(node, answers[node.id])) break; // frontier
      currentId = nextNodeId(node, answers[node.id]?.optionIds ?? []);
    }
    if (currentId == null) complete = true;
  }

  return { steps, complete };
}

/** Answers payload built ONLY from answered steps on the derived path. */
export function buildAnswersPayload(steps: PathStep[], answers: AnswersMap): AnswerIn[] {
  const out: AnswerIn[] = [];
  for (const s of steps) {
    const a = answers[s.id];
    if (!a || !isAnswered(s.question, a)) continue;
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
  const first = steps[0];
  if (first && first.question.questionType === 'date') {
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
