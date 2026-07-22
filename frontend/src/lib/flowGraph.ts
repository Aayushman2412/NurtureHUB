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
