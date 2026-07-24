/**
 * Graph utilities shared by the admin canvas builder and the learner runner.
 * Pure functions only — no React, no API calls.
 */

import { API_BASE_URL } from '../api/config';
import type {
  FlowNode,
  FlowOption,
  FlowQuestionNode,
  FlowSchema,
  FlowSectionChild,
} from './flowTypes';
import { isInfoNode, isMatrixNode, isQuestionNode, isSectionNode } from './flowTypes';

// ── Ids ──────────────────────────────────────────────────────────────────────

/** Short collision-safe id, e.g. `n_k3f9x2` / `o_a81b7c`. */
export const makeId = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-2)}`;

// ── Traversal ────────────────────────────────────────────────────────────────

/**
 * The next node id after answering `node` with the given selected options.
 * Single-select honours the selected option's branch override; every other
 * question type (and sections) follows the node default.
 */
export function nextNodeId(node: FlowNode, selectedOptionIds: string[]): string | null {
  if (isQuestionNode(node) && node.questionType === 'single' && selectedOptionIds.length === 1) {
    const opt = node.options.find(o => o.id === selectedOptionIds[0]);
    if (opt?.next) return opt.next;
  }
  return node.next;
}

/** Nodes reachable from startNodeId following default nexts + every option branch. */
export function reachableNodeIds(schema: FlowSchema): Set<string> {
  const seen = new Set<string>();
  if (!schema.startNodeId || !schema.nodes[schema.startNodeId]) return seen;
  const queue = [schema.startNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    const node = schema.nodes[id];
    if (!node) continue;
    seen.add(id);
    if (node.next && schema.nodes[node.next]) queue.push(node.next);
    if (isQuestionNode(node)) {
      for (const o of node.options) {
        if (o.next && schema.nodes[o.next]) queue.push(o.next);
      }
    }
  }
  return seen;
}

export interface AnswerableQuestion {
  /** The node that owns the step — the section node id for section children. */
  nodeId: string;
  /** Set when the question is a common-section child. */
  sectionId: string | null;
  question: FlowQuestionNode | FlowSectionChild;
}

/**
 * Every answerable question reachable from the start (section children expanded),
 * in a stable breadth-first order. Used for progress totals ("step X of ~N").
 */
export function flattenAnswerable(schema: FlowSchema): AnswerableQuestion[] {
  const out: AnswerableQuestion[] = [];
  for (const id of reachableNodeIds(schema)) {
    const node = schema.nodes[id];
    if (!node) continue;
    if (isSectionNode(node)) {
      for (const child of node.children) {
        out.push({ nodeId: child.id, sectionId: node.id, question: child });
      }
    } else if (isQuestionNode(node)) {
      out.push({ nodeId: node.id, sectionId: null, question: node });
    }
    // info + matrix nodes are steps but not answerable "questions"
  }
  return out;
}

// ── Validation (admin builder) ───────────────────────────────────────────────

export interface FlowIssue {
  level: 'error' | 'warning';
  nodeId: string | null;
  message: string;
}

export function validateFlow(schema: FlowSchema): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodeIds = Object.keys(schema.nodes);

  if (nodeIds.length === 0) {
    issues.push({ level: 'warning', nodeId: null, message: 'The form has no questions yet.' });
    return issues;
  }
  if (!schema.startNodeId) {
    issues.push({ level: 'error', nodeId: null, message: 'No start question set.' });
  } else if (!schema.nodes[schema.startNodeId]) {
    issues.push({ level: 'error', nodeId: null, message: 'Start question no longer exists.' });
  }

  const checkTarget = (nodeId: string, target: string | null, what: string) => {
    if (target && !schema.nodes[target]) {
      issues.push({ level: 'error', nodeId, message: `${what} points to a deleted question.` });
    }
  };

  const checkOptions = (nodeId: string, title: string, options: FlowOption[], allowBranch: boolean) => {
    if (options.length === 0) {
      issues.push({ level: 'warning', nodeId, message: `"${title || 'Untitled'}" has no answer options.` });
    }
    options.forEach((o, i) => {
      if (!o.label.trim() && o.media.length === 0) {
        issues.push({ level: 'warning', nodeId, message: `"${title || 'Untitled'}" option ${i + 1} has no text or media.` });
      }
      if (allowBranch) checkTarget(nodeId, o.next, `Option "${o.label || i + 1}" branch`);
      if (o.action.type === 'youtube' && !o.action.url.trim()) {
        issues.push({ level: 'warning', nodeId, message: `Option "${o.label || i + 1}" has a YouTube action without a link.` });
      }
      if (o.action.type === 'video' && !o.action.url.trim()) {
        issues.push({ level: 'warning', nodeId, message: `Option "${o.label || i + 1}" has a video action without a file or URL.` });
      }
      if ((o.action.type === 'notify' || o.action.type === 'info') && !o.action.message.trim()) {
        issues.push({ level: 'warning', nodeId, message: `Option "${o.label || i + 1}" has a message action without text.` });
      }
    });
  };

  for (const node of Object.values(schema.nodes)) {
    if (isInfoNode(node)) {
      checkTarget(node.id, node.next, `"${node.title || 'Info block'}" next step`);
      if (!node.title.trim() && !node.body.trim() && node.media.length === 0) {
        issues.push({ level: 'warning', nodeId: node.id, message: 'Info block has no title, text or media.' });
      }
      if (node.action.type === 'youtube' && !node.action.url.trim()) {
        issues.push({ level: 'warning', nodeId: node.id, message: 'Info block has a YouTube action without a link.' });
      }
      if (node.action.type === 'video' && !node.action.url.trim()) {
        issues.push({ level: 'warning', nodeId: node.id, message: 'Info block has a video action without a file or URL.' });
      }
      continue;
    }
    if (isMatrixNode(node)) {
      checkTarget(node.id, node.next, `"${node.title || 'Matrix'}" next step`);
      if (!node.title.trim()) {
        issues.push({ level: 'warning', nodeId: node.id, message: 'Matrix question has no title.' });
      }
      if (node.rows.length === 0) {
        issues.push({ level: 'warning', nodeId: node.id, message: `"${node.title || 'Matrix'}" has no rows.` });
      }
      if (node.columns.length === 0) {
        issues.push({ level: 'warning', nodeId: node.id, message: `"${node.title || 'Matrix'}" has no columns.` });
      }
      node.columns.forEach((c, i) => {
        if (!c.label.trim()) {
          issues.push({ level: 'warning', nodeId: node.id, message: `Matrix column ${i + 1} has no label.` });
        }
        if (c.type === 'dropdown' && (!c.options || c.options.length === 0)) {
          issues.push({ level: 'warning', nodeId: node.id, message: `Matrix column "${c.label || i + 1}" is a dropdown with no options.` });
        }
      });
      continue;
    }

    if (!node.title.trim()) {
      issues.push({ level: 'warning', nodeId: node.id, message: 'Question text is empty.' });
    }
    checkTarget(node.id, node.next, `"${node.title || 'Untitled'}" next step`);
    if (isQuestionNode(node)) {
      if (node.questionType === 'single' || node.questionType === 'multi') {
        checkOptions(node.id, node.title, node.options, node.questionType === 'single');
      }
    } else {
      if (node.children.length === 0) {
        issues.push({ level: 'warning', nodeId: node.id, message: `Common section "${node.title || 'Untitled'}" is empty.` });
      }
      for (const child of node.children) {
        if (!child.title.trim()) {
          issues.push({ level: 'warning', nodeId: node.id, message: 'A question inside the common section has no text.' });
        }
        if (child.questionType === 'single' || child.questionType === 'multi') {
          checkOptions(node.id, child.title, child.options, false);
        }
      }
    }
  }

  // Visibility rules must reference an existing single/multi question and its
  // real option ids — a broken rule would silently hide the node forever.
  for (const node of Object.values(schema.nodes)) {
    const rule = node.visibleIf;
    if (!rule) continue;
    const label = ('title' in node && node.title) || node.id;
    const source = schema.nodes[rule.nodeId];
    if (!source) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${label}" visibility depends on a deleted question.` });
      continue;
    }
    if (!isQuestionNode(source) || (source.questionType !== 'single' && source.questionType !== 'multi')) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${label}" visibility must depend on a single/multi-select question.` });
      continue;
    }
    if (rule.anyOf.length === 0) {
      issues.push({ level: 'warning', nodeId: node.id, message: `"${label}" has a visibility rule with no options — it will never be shown.` });
    }
    const optionIds = new Set(source.options.map(o => o.id));
    for (const id of rule.anyOf) {
      if (!optionIds.has(id)) {
        issues.push({ level: 'error', nodeId: node.id, message: `"${label}" visibility references a deleted answer option.` });
        break;
      }
    }
  }

  const reachable = reachableNodeIds(schema);
  const orphans = nodeIds.filter(id => !reachable.has(id));
  if (schema.startNodeId && schema.nodes[schema.startNodeId] && orphans.length > 0) {
    issues.push({
      level: 'warning',
      nodeId: orphans[0],
      message: `${orphans.length} question${orphans.length > 1 ? 's are' : ' is'} not connected to the flow.`,
    });
  }

  return issues;
}

// ── Restructuring (admin builder) ────────────────────────────────────────────

/**
 * What moving a question into a section would change — shown to the admin
 * before the move, because section children cannot branch.
 */
export interface MoveIntoSectionImpact {
  /** Per-option branch overrides that will be discarded. */
  branchOverrides: number;
  /** Other steps/answers currently pointing at this question (they will be
   *  redirected to the section, i.e. the flow will enter at the section's
   *  first question instead). */
  incomingRefs: number;
  /** The question is the form's start step. */
  isStart: boolean;
}

export function moveIntoSectionImpact(schema: FlowSchema, questionId: string): MoveIntoSectionImpact {
  const node = schema.nodes[questionId];
  const branchOverrides =
    node && isQuestionNode(node) ? node.options.filter(o => o.next).length : 0;
  let incomingRefs = 0;
  for (const other of Object.values(schema.nodes)) {
    if (other.id === questionId) continue;
    if (other.next === questionId) incomingRefs += 1;
    if (isQuestionNode(other)) {
      incomingRefs += other.options.filter(o => o.next === questionId).length;
    }
  }
  return { branchOverrides, incomingRefs, isStart: schema.startNodeId === questionId };
}

/**
 * Move a standalone question node into a common section, as its last child.
 *
 * The question's id AND its option ids are preserved — stored responses and
 * drafts key answers by these ids (the backend's question index covers
 * section children), so a move must never mint new ones.
 *
 * What changes:
 *  - `position`, `next` and every option's branch `next` are dropped
 *    (section children run in order and cannot branch);
 *  - every pointer at the question (other nodes' `next`, option branches,
 *    `startNodeId`) is redirected to the section — except the section's own
 *    `next`, which skips over the absorbed question to the question's old
 *    `next` (redirecting it to itself would self-loop).
 *
 * Returns null when ids are missing or of the wrong kind (caller keeps the
 * schema unchanged).
 */
export function moveQuestionIntoSection(
  schema: FlowSchema,
  questionId: string,
  sectionId: string,
): FlowSchema | null {
  const question = schema.nodes[questionId];
  const section = schema.nodes[sectionId];
  if (!question || !section || !isQuestionNode(question) || !isSectionNode(section)) return null;

  const child: FlowSectionChild = {
    id: question.id,
    kind: 'question',
    questionType: question.questionType,
    title: question.title,
    helpText: question.helpText,
    required: question.required,
    ...(question.media !== undefined && { media: question.media }),
    options: question.options.map(o => ({ ...o, next: null })),
    ...(question.numeric !== undefined && { numeric: question.numeric }),
    ...(question.display !== undefined && { display: question.display }),
  };

  const redirect = (target: string | null): string | null =>
    target === questionId ? sectionId : target;

  const nodes: Record<string, FlowNode> = {};
  for (const node of Object.values(schema.nodes)) {
    if (node.id === questionId) continue; // absorbed
    if (node.id === sectionId) {
      nodes[node.id] = {
        ...section,
        children: [...section.children, child],
        // Skip over the absorbed question rather than self-looping.
        next: section.next === questionId ? question.next : section.next,
      };
      continue;
    }
    let updated: FlowNode = node;
    if (node.next === questionId) updated = { ...updated, next: sectionId };
    if (isQuestionNode(updated) && updated.options.some(o => o.next === questionId)) {
      updated = {
        ...updated,
        options: updated.options.map(o => (o.next === questionId ? { ...o, next: sectionId } : o)),
      };
    }
    nodes[node.id] = updated;
  }

  return {
    ...schema,
    startNodeId: redirect(schema.startNodeId),
    nodes,
  };
}

/**
 * Pull a question out of a common section and back onto the canvas as a
 * standalone node, inserted into the default chain immediately AFTER the
 * section (child order inside the section no longer applies once it leaves).
 *
 * Ids are preserved for the same stored-response reasons as the move in.
 * Returns null when ids are missing or of the wrong kind.
 */
export function moveChildOutOfSection(
  schema: FlowSchema,
  sectionId: string,
  childId: string,
): FlowSchema | null {
  const section = schema.nodes[sectionId];
  if (!section || !isSectionNode(section)) return null;
  const childIndex = section.children.findIndex(c => c.id === childId);
  if (childIndex === -1 || schema.nodes[childId]) return null;

  const child = section.children[childIndex];
  const node: FlowQuestionNode = {
    id: child.id,
    kind: 'question',
    questionType: child.questionType,
    title: child.title,
    helpText: child.helpText,
    required: child.required,
    ...(child.media !== undefined && { media: child.media }),
    // Right of the section card, staggered so repeated ejects don't stack.
    position: { x: section.position.x + 360, y: section.position.y + childIndex * 56 },
    options: child.options.map(o => ({ ...o })),
    ...(child.numeric !== undefined && { numeric: child.numeric }),
    ...(child.display !== undefined && { display: child.display }),
    next: section.next,
  };

  return {
    ...schema,
    nodes: {
      ...schema.nodes,
      [sectionId]: {
        ...section,
        children: section.children.filter(c => c.id !== childId),
        next: node.id,
      },
      [node.id]: node,
    },
  };
}

// ── YouTube & timestamps ─────────────────────────────────────────────────────

/** Extract a YouTube video id from watch/short/embed/youtu.be URLs (or a bare id). */
export function parseYouTubeId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [
    /youtube\.com\/watch\?.*v=([\w-]{11})/,
    /youtube\.com\/(?:embed|shorts|live)\/([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[1];
  }
  return null;
}

/** Privacy-enhanced embed URL honouring an optional start/end clip window. */
export function youTubeEmbedUrl(
  url: string,
  startSeconds?: number | null,
  endSeconds?: number | null,
): string | null {
  const id = parseYouTubeId(url);
  if (!id) return null;
  const params = new URLSearchParams({ rel: '0', modestbranding: '1' });
  if (startSeconds != null && startSeconds > 0) params.set('start', String(Math.floor(startSeconds)));
  if (endSeconds != null && endSeconds > 0) params.set('end', String(Math.floor(endSeconds)));
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

/** "1:23", "01:02:03", "95", "1m30s" → seconds. Returns null for un-parseable input. */
export function parseTimestamp(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const hms = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (hms) {
    const [, h, m, sec] = hms;
    return (h ? parseInt(h, 10) * 3600 : 0) + parseInt(m, 10) * 60 + parseInt(sec, 10);
  }
  const units = s.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return (
      (units[1] ? parseInt(units[1], 10) * 3600 : 0) +
      (units[2] ? parseInt(units[2], 10) * 60 : 0) +
      (units[3] ? parseInt(units[3], 10) : 0)
    );
  }
  return null;
}

/** Seconds → "m:ss" / "h:mm:ss" for display. */
export function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Assets ───────────────────────────────────────────────────────────────────

/** Uploaded assets are stored as backend-relative `/uploads/...` paths. */
export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('/uploads/')) return `${API_BASE_URL}${url}`;
  return url;
}
