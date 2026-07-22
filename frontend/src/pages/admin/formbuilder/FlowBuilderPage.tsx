import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BoxSelect, ClipboardPaste, Copy, Eye, Info, Layers, Plus, Redo2, Save, Table, Trash2, Undo2, X } from 'lucide-react';
import { adminGetForm, adminSaveForm } from '../../../api/forms';
import { validateFlow } from '../../../lib/flowGraph';
import {
  emptyFlowSchema,
  isBuiltinVerdict,
  isFlowFormKey,
  resolveDisplay,
  resolveVerdicts,
} from '../../../lib/flowTypes';
import type {
  FlowDisplaySettings,
  FlowNode,
  FlowOption,
  FlowSchema,
  FormDefinition,
  VerdictDef,
  VerdictScoring,
  VerdictTiming,
} from '../../../lib/flowTypes';
import { useToast } from '../../../context/ToastContext';
import { Alert, Badge, Button, Checkbox, Input, Modal, PageLoader, Radio, Select } from '../../../components/ui';
import FlowCanvas from '../../../components/flowbuilder/FlowCanvas';
import NodeEditorPanel from '../../../components/flowbuilder/NodeEditorPanel';
import ValidationChip from '../../../components/flowbuilder/ValidationChip';
import {
  cloneNodesForPaste,
  duplicateNode,
  makeInfoNode,
  makeMatrixNode,
  makeQuestionNode,
  makeSectionNode,
} from '../../../components/flowbuilder/factories';
import type { ConnectRequest, NodePatch } from '../../../components/flowbuilder/constants';
import { useDirtyGuard } from '../../../components/flowbuilder/useDirtyGuard';

const LEAVE_MESSAGE = 'You have unsaved changes to this form. Leave without saving?';

/** Where a newly added card lands: under the current bottom-most card. */
const spawnPosition = (schema: FlowSchema): { x: number; y: number } => {
  const nodes = Object.values(schema.nodes);
  if (nodes.length === 0) return { x: 120, y: 120 };
  const minX = Math.min(...nodes.map(n => n.position.x));
  const maxY = Math.max(...nodes.map(n => n.position.y));
  return { x: minX, y: maxY + 200 };
};

/**
 * What the admin can hide from the learner. Order = display order in the panel.
 * These affect DISPLAY ONLY — every answer is still collected and stored.
 * Verdict timing is a three-way choice, so it lives in TIMING_OPTIONS below.
 */
type BooleanDisplayKey = Exclude<keyof FlowDisplaySettings, 'verdictTiming'>;

const DISPLAY_TOGGLES: { key: BooleanDisplayKey; label: string; hint: string }[] = [
  { key: 'helpText', label: 'Help text', hint: 'The guidance line under each question.' },
  { key: 'questionMedia', label: 'Question images / GIFs', hint: 'Illustrations attached to a question. Turn off to save mobile data.' },
  { key: 'optionMedia', label: 'Answer option images', hint: 'Pictures on the answer cards; they fall back to a letter tile.' },
  { key: 'actions', label: 'Coaching actions', hint: 'Action cards on the assessment plan and their notifications. Negative answers still appear under “needs attention”.' },
];

const TIMING_OPTIONS: { value: VerdictTiming; label: string; hint: string }[] = [
  {
    value: 'after',
    label: 'After submitting',
    hint: 'Recommended. Feedback appears on the assessment plan, so seeing a verdict cannot change the answer given.',
  },
  {
    value: 'during',
    label: 'While answering',
    hint: 'Training mode: instant feedback teaches, but the worker can change their answer after seeing it — which quietly biases the data.',
  },
  { value: 'never', label: 'Never', hint: 'Pure data collection — the worker never sees verdicts.' },
];

const SCORING_OPTIONS: { value: VerdictScoring; label: string }[] = [
  { value: 'positive', label: 'Counts as good' },
  { value: 'negative', label: 'Needs attention' },
  { value: 'neutral', label: 'Not scored' },
];

/** The canvas decision-tree designer for flow forms (breastfeeding / CF). */
const FlowBuilderPage: React.FC = () => {
  const { formKey } = useParams<{ formKey: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [def, setDef] = useState<FormDefinition | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [reloadTick, setReloadTick] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [schema, setSchema] = useState<FlowSchema>(emptyFlowSchema());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [connect, setConnect] = useState<ConnectRequest | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);

  // The editor panel edits a single node — only when exactly one is selected.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const validKey = !!formKey && isFlowFormKey(formKey);
  useDirtyGuard(dirty, LEAVE_MESSAGE);

  // Latest schema/selection for stable callbacks and keyboard handlers.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Clipboard for Ctrl+C / Ctrl+V (deep snapshots taken at copy time).
  const clipboardRef = useRef<FlowNode[]>([]);
  const pasteCountRef = useRef(0);

  // Undo/redo history. Entries are previous schema objects (structurally
  // shared — every mutation is immutable, so this is cheap). historyTick only
  // exists to re-render the toolbar buttons when the ref stacks change.
  const historyRef = useRef<FlowSchema[]>([]);
  const futureRef = useRef<FlowSchema[]>([]);
  const lastHistoryRef = useRef<{ key: string | null; time: number }>({ key: null, time: 0 });
  const [, setHistoryTick] = useState(0);
  const HISTORY_LIMIT = 100;

  const issues = useMemo(() => validateFlow(schema), [schema]);

  const display = useMemo(() => resolveDisplay(schema.display), [schema.display]);
  const verdictDefs = useMemo(() => resolveVerdicts(schema.verdicts), [schema.verdicts]);
  const hiddenCount =
    DISPLAY_TOGGLES.filter(t => !display[t.key]).length +
    (display.verdictTiming === 'never' ? 1 : 0);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!formKey || !isFlowFormKey(formKey)) return;
    let cancelled = false;
    setLoadState('loading');
    adminGetForm(formKey)
      .then(d => {
        if (cancelled) return;
        if (d.builder_type !== 'flow') {
          navigate(`/admin/form-builder/flat/${formKey}`, { replace: true });
          return;
        }
        const s = d.schema_json as FlowSchema;
        setDef(d);
        setTitle(d.title);
        setDescription(d.description ?? '');
        setSchema(
          s && typeof s === 'object' && s.nodes
            ? {
                startNodeId: s.startNodeId ?? null,
                nodes: s.nodes,
                display: resolveDisplay(s.display),
                verdicts: resolveVerdicts(s.verdicts),
              }
            : emptyFlowSchema(),
        );
        setSelectedIds([]);
        setConnect(null);
        setDirty(false);
        historyRef.current = [];
        futureRef.current = [];
        lastHistoryRef.current = { key: null, time: 0 };
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [formKey, navigate, reloadTick]);

  // ── Schema mutations (stable callbacks so canvas cards can memo) ──────────
  // Computes against schemaRef (kept hot below) so no-op updaters don't flag
  // the form dirty, and same-tick patches chain instead of clobbering.
  // `historyKey`: consecutive patches sharing a key within a short window
  // coalesce into ONE undo step (card drags, typing bursts) — the pre-state is
  // pushed only for the first patch of the burst.
  const patchSchema = useCallback((fn: (s: FlowSchema) => FlowSchema, historyKey?: string) => {
    const prev = schemaRef.current;
    const next = fn(prev);
    if (next === prev) return;

    const now = Date.now();
    const last = lastHistoryRef.current;
    const coalesce = !!historyKey && last.key === historyKey && now - last.time < 800;
    if (!coalesce) {
      historyRef.current.push(prev);
      if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
      futureRef.current = [];
      setHistoryTick(t => t + 1);
    }
    lastHistoryRef.current = { key: historyKey ?? null, time: now };

    schemaRef.current = next;
    setSchema(next);
    setDirty(true);
  }, []);

  /** Flip one learner-visibility switch (undoable + marks the form dirty). */
  const toggleDisplay = useCallback(
    (key: BooleanDisplayKey) =>
      patchSchema(s => {
        const current = resolveDisplay(s.display);
        return { ...s, display: { ...current, [key]: !current[key] } };
      }),
    [patchSchema],
  );

  const setVerdictTiming = useCallback(
    (timing: VerdictTiming) =>
      patchSchema(s => ({ ...s, display: { ...resolveDisplay(s.display), verdictTiming: timing } })),
    [patchSchema],
  );

  // ── Verdict vocabulary ────────────────────────────────────────────────────

  const patchVerdicts = useCallback(
    (fn: (defs: VerdictDef[]) => VerdictDef[]) =>
      patchSchema(s => ({ ...s, verdicts: fn(resolveVerdicts(s.verdicts)) })),
    [patchSchema],
  );

  const addVerdict = useCallback(
    () =>
      patchVerdicts(defs => {
        // ids must be stable and unique — options store the id, not the label.
        let n = defs.length + 1;
        while (defs.some(d => d.id === `verdict_${n}`)) n += 1;
        return [
          ...defs,
          { id: `verdict_${n}`, label: `Verdict ${n}`, color: '#6366f1', scoring: 'neutral' },
        ];
      }),
    [patchVerdicts],
  );

  const editVerdict = useCallback(
    (id: string, patch: Partial<Omit<VerdictDef, 'id'>>) =>
      patchVerdicts(defs => defs.map(d => (d.id === id ? { ...d, ...patch } : d))),
    [patchVerdicts],
  );

  /** How many options currently reference a verdict — shown before removing. */
  const verdictUsage = useCallback(
    (id: string) =>
      Object.values(schema.nodes).reduce((total, node) => {
        // Only questions and section children carry options — info/matrix don't.
        const questions: { options: FlowOption[] }[] =
          node.kind === 'section' ? node.children : node.kind === 'question' ? [node] : [];
        return (
          total +
          questions.reduce((n, q) => n + q.options.filter(o => o.verdict === id).length, 0)
        );
      }, 0),
    [schema.nodes],
  );

  /**
   * Remove a verdict and clear it from every option that used it (those become
   * neutral). Done in one patch so a single undo restores both.
   */
  const removeVerdict = useCallback(
    (id: string) =>
      patchSchema(s => ({
        ...s,
        verdicts: resolveVerdicts(s.verdicts).filter(d => d.id !== id),
        nodes: Object.fromEntries(
          Object.entries(s.nodes).map(([nodeId, node]) => {
            // Questions carry the options; a section carries child questions.
            const clear = <T extends { options: FlowOption[] }>(q: T): T =>
              q.options.some(o => o.verdict === id)
                ? { ...q, options: q.options.map(o => (o.verdict === id ? { ...o, verdict: null } : o)) }
                : q;
            return [
              nodeId,
              node.kind === 'section'
                ? { ...node, children: node.children.map(clear) }
                : node.kind === 'question'
                  ? clear(node)
                  : node, // info / matrix carry no options
            ];
          }),
        ) as Record<string, FlowNode>,
      })),
    [patchSchema],
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    futureRef.current.push(schemaRef.current);
    schemaRef.current = prev;
    setSchema(prev);
    setDirty(true);
    setSelectedIds(cur => cur.filter(id => prev.nodes[id]));
    setConnect(null);
    lastHistoryRef.current = { key: null, time: 0 };
    setHistoryTick(t => t + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(schemaRef.current);
    schemaRef.current = next;
    setSchema(next);
    setDirty(true);
    setSelectedIds(cur => cur.filter(id => next.nodes[id]));
    setConnect(null);
    lastHistoryRef.current = { key: null, time: 0 };
    setHistoryTick(t => t + 1);
  }, []);

  const patchNode = useCallback(
    (id: string, patch: NodePatch) => {
      // Coalesced per node so a typing burst in the editor = one undo step.
      patchSchema(s => {
        const node = s.nodes[id];
        if (!node) return s;
        return { ...s, nodes: { ...s.nodes, [id]: { ...node, ...patch } as FlowNode } };
      }, `node:${id}`);
    },
    [patchSchema],
  );

  const moveNode = useCallback(
    (id: string, position: { x: number; y: number }) => {
      patchSchema(s => {
        const node = s.nodes[id];
        if (!node) return s;
        const dx = position.x - node.position.x;
        const dy = position.y - node.position.y;
        if (dx === 0 && dy === 0) return s;
        // Dragging a card that belongs to the current multi-selection moves
        // the whole selection together (delta is grid-snapped already).
        const selection = selectedIdsRef.current;
        const moveIds = selection.includes(id) && selection.length > 1 ? selection : [id];
        const nodes = { ...s.nodes };
        for (const moveId of moveIds) {
          const n = nodes[moveId];
          if (!n) continue;
          nodes[moveId] = {
            ...n,
            position: { x: n.position.x + dx, y: n.position.y + dy },
          } as FlowNode;
        }
        return { ...s, nodes };
      }, `move:${id}`); // a whole drag = one undo step
    },
    [patchSchema],
  );

  const addQuestion = useCallback(() => {
    const node = makeQuestionNode(spawnPosition(schemaRef.current));
    patchSchema(s => ({ startNodeId: s.startNodeId ?? node.id, nodes: { ...s.nodes, [node.id]: node } }));
    setSelectedIds([node.id]);
  }, [patchSchema]);

  const addSection = useCallback(() => {
    const node = makeSectionNode(spawnPosition(schemaRef.current));
    patchSchema(s => ({ startNodeId: s.startNodeId ?? node.id, nodes: { ...s.nodes, [node.id]: node } }));
    setSelectedIds([node.id]);
  }, [patchSchema]);

  const addInfo = useCallback(() => {
    const node = makeInfoNode(spawnPosition(schemaRef.current));
    patchSchema(s => ({ startNodeId: s.startNodeId ?? node.id, nodes: { ...s.nodes, [node.id]: node } }));
    setSelectedIds([node.id]);
  }, [patchSchema]);

  const addMatrix = useCallback(() => {
    const node = makeMatrixNode(spawnPosition(schemaRef.current));
    patchSchema(s => ({ startNodeId: s.startNodeId ?? node.id, nodes: { ...s.nodes, [node.id]: node } }));
    setSelectedIds([node.id]);
  }, [patchSchema]);

  const duplicate = useCallback(
    (id: string) => {
      const src = schemaRef.current.nodes[id];
      if (!src) return;
      const copy = duplicateNode(src);
      patchSchema(s => ({ ...s, nodes: { ...s.nodes, [copy.id]: copy } }));
      setSelectedIds([copy.id]);
    },
    [patchSchema],
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      const present = ids.filter(id => schemaRef.current.nodes[id]);
      if (present.length === 0) return;
      const label = present.length === 1 ? 'this step' : `these ${present.length} steps`;
      if (!window.confirm(`Delete ${label}? Connections pointing to ${present.length === 1 ? 'it' : 'them'} will be cleared.`)) {
        return;
      }
      const doomed = new Set(present);
      setConnect(null);
      setSelectedIds(cur => cur.filter(id => !doomed.has(id)));
      patchSchema(s => {
        const nodes: Record<string, FlowNode> = {};
        for (const [key, n] of Object.entries(s.nodes)) {
          if (doomed.has(key)) continue;
          if (n.kind === 'question') {
            let q = n;
            if (q.next && doomed.has(q.next)) q = { ...q, next: null };
            if (q.options.some(o => o.next && doomed.has(o.next))) {
              q = {
                ...q,
                options: q.options.map(o => (o.next && doomed.has(o.next) ? { ...o, next: null } : o)),
              };
            }
            nodes[key] = q;
          } else {
            nodes[key] = n.next && doomed.has(n.next) ? { ...n, next: null } : n;
          }
        }
        const remaining = Object.keys(nodes);
        const startNodeId =
          s.startNodeId && doomed.has(s.startNodeId) ? remaining[0] ?? null : s.startNodeId;
        return { startNodeId, nodes };
      });
    },
    [patchSchema],
  );

  const deleteNode = useCallback((id: string) => deleteNodes([id]), [deleteNodes]);

  const setStart = useCallback(
    (id: string) => patchSchema(s => (s.startNodeId === id ? s : { ...s, startNodeId: id })),
    [patchSchema],
  );

  // ── Click-to-connect ──────────────────────────────────────────────────────
  const connectTarget = useCallback(
    (targetId: string) => {
      if (!connect) return;
      if (targetId === connect.nodeId) {
        showToast('A step cannot connect to itself', 'warning');
        return;
      }
      const { nodeId, optionId } = connect;
      patchSchema(s => {
        const node = s.nodes[nodeId];
        if (!node || !s.nodes[targetId]) return s;
        if (optionId === null) {
          return { ...s, nodes: { ...s.nodes, [nodeId]: { ...node, next: targetId } as FlowNode } };
        }
        // Option branches only exist on single-choice questions, and the armed
        // option must still exist — the question may have been retyped or the
        // option removed while connect mode was pending.
        if (
          node.kind !== 'question' ||
          node.questionType !== 'single' ||
          !node.options.some(o => o.id === optionId)
        ) {
          return s;
        }
        return {
          ...s,
          nodes: {
            ...s.nodes,
            [nodeId]: {
              ...node,
              options: node.options.map(o => (o.id === optionId ? { ...o, next: targetId } : o)),
            },
          },
        };
      });
      setConnect(null);
    },
    [connect, patchSchema, showToast],
  );

  const cancelConnect = useCallback(() => setConnect(null), []);

  useEffect(() => {
    if (!connect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connect]);

  // Disarm connect mode when its source becomes invalid mid-connect (node
  // deleted, question retyped away from single-choice, or the option removed).
  useEffect(() => {
    if (!connect) return;
    const node = schema.nodes[connect.nodeId];
    if (!node) {
      setConnect(null);
      return;
    }
    if (connect.optionId !== null) {
      const stillValid =
        node.kind === 'question' &&
        node.questionType === 'single' &&
        node.options.some(o => o.id === connect.optionId);
      if (!stillValid) setConnect(null);
    }
  }, [schema, connect]);

  // ── Save / navigation ─────────────────────────────────────────────────────
  const save = async () => {
    if (!formKey || !isFlowFormKey(formKey)) return;
    setSaving(true);
    try {
      const updated = await adminSaveForm(formKey, {
        title: title.trim() || def?.title || 'Untitled form',
        description,
        schema_json: schemaRef.current,
      });
      setDef(updated);
      // Sync local state from what the server actually stored — e.g. a blanked
      // title falls back to the previous one, and the input must show that.
      setTitle(updated.title);
      setDescription(updated.description ?? '');
      setDirty(false);
      showToast(`Saved — version ${updated.version} is live for learners`, 'success');
    } catch {
      showToast('Could not save the form. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (dirty && !window.confirm(LEAVE_MESSAGE)) return;
    navigate('/admin/form-builder');
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const selectIssue = useCallback((nodeId: string | null) => setSelectedIds(nodeId ? [nodeId] : []), []);
  const selectNode = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);
  const cardSelect = useCallback((id: string, additive: boolean) => {
    setSelectedIds(cur => {
      if (!additive) return [id];
      return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    });
  }, []);
  const marqueeSelect = useCallback((ids: string[], additive: boolean) => {
    setSelectedIds(cur => (additive ? Array.from(new Set([...cur, ...ids])) : ids));
  }, []);
  const startConnect = useCallback((req: ConnectRequest) => setConnect(req), []);

  // ── Clipboard (Ctrl+C / Ctrl+V) & Delete ──────────────────────────────────
  const copySelection = useCallback((): boolean => {
    const nodes = selectedIdsRef.current
      .map(id => schemaRef.current.nodes[id])
      .filter(Boolean) as FlowNode[];
    if (nodes.length === 0) return false;
    clipboardRef.current = JSON.parse(JSON.stringify(nodes));
    pasteCountRef.current = 0;
    showToast(`Copied ${nodes.length} step${nodes.length === 1 ? '' : 's'} — Ctrl+V to paste`, 'success');
    return true;
  }, [showToast]);

  const pasteClipboard = useCallback((): boolean => {
    if (clipboardRef.current.length === 0) return false;
    pasteCountRef.current += 1;
    const offset = 40 * pasteCountRef.current;
    const clones = cloneNodesForPaste(clipboardRef.current, { x: offset, y: offset });
    patchSchema(s => {
      const nodes = { ...s.nodes };
      for (const clone of clones) nodes[clone.id] = clone;
      return { startNodeId: s.startNodeId ?? clones[0]?.id ?? null, nodes };
    });
    setSelectedIds(clones.map(c => c.id));
    showToast(`Pasted ${clones.length} step${clones.length === 1 ? '' : 's'}`, 'success');
    return true;
  }, [patchSchema, showToast]);

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'c') {
        // Let a native text-copy win when the admin has text highlighted.
        if (window.getSelection()?.toString()) return;
        if (copySelection()) e.preventDefault();
      } else if (mod && e.key.toLowerCase() === 'v') {
        if (pasteClipboard()) e.preventDefault();
      } else if (e.key === 'Delete') {
        if (selectedIdsRef.current.length > 0) {
          e.preventDefault();
          deleteNodes(selectedIdsRef.current);
        }
      } else if (e.key === 'Escape' && !connect) {
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copySelection, pasteClipboard, deleteNodes, connect, undo, redo]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (!validKey) {
    return (
      <Alert variant="error" title="Unknown form">
        This form key has no canvas designer. Head back to the{' '}
        <a href="/admin/form-builder" className="font-bold underline">
          Form Builder
        </a>
        .
      </Alert>
    );
  }

  if (loadState === 'loading') return <PageLoader label="Loading the canvas designer…" />;

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <Alert variant="error" title="Could not load this form">
          Check your connection and try again.
        </Alert>
        <Button variant="outline" onClick={() => setReloadTick(t => t + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-screen flex-col overflow-hidden bg-background lg:-m-8">
      {/* Toolbar */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-4 py-2.5">
        <button
          type="button"
          onClick={goBack}
          title="Back to Form Builder"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
        >
          <ArrowLeft className="size-4.5" />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <input
            value={title}
            onChange={e => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            aria-label="Form title"
            placeholder="Form title"
            className="w-56 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-display text-base font-bold text-ink outline-none transition-colors hover:border-border focus:border-primary focus:ring-2 focus:ring-primary/25 lg:w-72"
          />
          <Badge variant="coral">Canvas designer</Badge>
          {def && <Badge variant="neutral">v{def.version}</Badge>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
            <button
              type="button"
              title="Undo (Ctrl+Z)"
              disabled={historyRef.current.length === 0}
              onClick={undo}
              className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:pointer-events-none disabled:opacity-35"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              type="button"
              title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
              disabled={futureRef.current.length === 0}
              onClick={redo}
              className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:pointer-events-none disabled:opacity-35"
            >
              <Redo2 className="size-4" />
            </button>
          </div>
          <Button size="sm" variant="outline" iconLeft={<Plus className="size-4" />} onClick={addQuestion}>
            Question
          </Button>
          <Button size="sm" variant="outline" iconLeft={<Layers className="size-4" />} onClick={addSection}>
            Common section
          </Button>
          <Button size="sm" variant="outline" iconLeft={<Table className="size-4" />} onClick={addMatrix}>
            Matrix
          </Button>
          <Button size="sm" variant="outline" iconLeft={<Info className="size-4" />} onClick={addInfo}>
            Info block
          </Button>
          <Button
            size="sm"
            variant="outline"
            iconLeft={<Eye className="size-4" />}
            onClick={() => setDisplayOpen(true)}
            title="Choose what learners see while filling this form"
          >
            Learner view
            {hiddenCount > 0 && (
              <Badge variant="warning" className="ml-1.5">
                {hiddenCount} hidden
              </Badge>
            )}
          </Button>
          <ValidationChip issues={issues} onSelectIssue={selectIssue} />
          {dirty && (
            <span
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-500"
              title="You have unsaved changes"
            >
              <span className="size-2 animate-pulse rounded-full bg-amber-500" />
              Unsaved
            </span>
          )}
          <Button size="sm" iconLeft={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={save}>
            Save
          </Button>
        </div>
      </header>

      <Modal
        open={displayOpen}
        onClose={() => setDisplayOpen(false)}
        title="What learners see"
        size="md"
        footer={
          <Button onClick={() => setDisplayOpen(false)}>Done</Button>
        }
      >
        <p className="text-sm text-ink-muted">
          Hide parts of this form from the health worker filling it in. Every answer is still
          collected and stored — this only changes what is shown on screen. These are the form-wide
          defaults; each question can override them in its own editor panel. Changes apply when you
          save the form.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {/* Checkbox renders its own <label>, so the row content goes in its
              `label` slot — nesting it inside another <label> would be invalid. */}
          {DISPLAY_TOGGLES.map(({ key, label, hint }) => (
            <Checkbox
              key={key}
              checked={display[key]}
              onChange={() => toggleDisplay(key)}
              className="flex items-start gap-3 rounded-xl border border-border p-3.5 transition-colors hover:bg-surface-sunken"
              label={
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{label}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
                </span>
              }
            />
          ))}
        </div>

        {/* ── When verdicts are revealed ─────────────────────────────────── */}
        <h4 className="mt-6 font-display text-sm font-bold text-ink">Show verdicts</h4>
        <p className="mt-1 text-xs text-ink-muted">
          A verdict tells the worker whether an answer was right. Reveal it too early and they can
          simply change the answer — so the assessment records what they learned scores well, not
          what actually happened.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {TIMING_OPTIONS.map(({ value, label, hint }) => (
            <Radio
              key={value}
              name="verdict-timing"
              checked={display.verdictTiming === value}
              onChange={() => setVerdictTiming(value)}
              className="flex items-start gap-3 rounded-xl border border-border p-3.5 transition-colors hover:bg-surface-sunken"
              label={
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{label}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
                </span>
              }
            />
          ))}
        </div>

        {/* ── Verdict vocabulary ─────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <h4 className="font-display text-sm font-bold text-ink">Verdicts</h4>
          <Button size="sm" variant="outline" iconLeft={<Plus className="size-3.5" />} onClick={addVerdict}>
            Add verdict
          </Button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          “Counts as good” and “Needs attention” drive the score and the assessment plan. “Not
          scored” verdicts are labels only.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {verdictDefs.map(def => {
            const used = verdictUsage(def.id);
            return (
              <div key={def.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${def.label} colour`}
                    value={def.color}
                    onChange={e => editVerdict(def.id, { color: e.target.value })}
                    className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5"
                  />
                  <Input
                    value={def.label}
                    onChange={e => editVerdict(def.id, { label: e.target.value })}
                    placeholder="Verdict name"
                    className="py-1.5 text-[13px]"
                  />
                  <button
                    type="button"
                    title={
                      used > 0
                        ? `Used by ${used} option(s) — removing clears them to Neutral`
                        : 'Remove verdict'
                    }
                    onClick={() => {
                      if (
                        used > 0 &&
                        !window.confirm(
                          `“${def.label}” is used by ${used} answer option(s).\n\n` +
                            'Removing it will set those options to Neutral. Continue?',
                        )
                      ) {
                        return;
                      }
                      removeVerdict(def.id);
                    }}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Select
                    value={def.scoring}
                    onChange={e => editVerdict(def.id, { scoring: e.target.value as VerdictScoring })}
                    className="py-1.5 text-[12px]"
                  >
                    {SCORING_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {used} option{used === 1 ? '' : 's'}
                  </span>
                </div>
                {isBuiltinVerdict(def.id) && (
                  <p className="mt-1.5 text-[11px] text-ink-faint">
                    Built-in — its name stays translated for learners; the colour and scoring are
                    yours to change.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Editor panel + canvas */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-border bg-surface">
          {selectedIds.length > 1 ? (
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-lg bg-coral-50 text-primary dark:bg-coral-500/10">
                  <BoxSelect className="size-4.5" />
                </span>
                <div>
                  <div className="font-display text-sm font-bold text-ink">
                    {selectedIds.length} steps selected
                  </div>
                  <div className="text-xs text-ink-muted">
                    Copy, paste or delete them together.
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" iconLeft={<Copy className="size-4" />} onClick={copySelection}>
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  iconLeft={<ClipboardPaste className="size-4" />}
                  onClick={pasteClipboard}
                >
                  Paste
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  iconLeft={<Trash2 className="size-4" />}
                  onClick={() => deleteNodes(selectedIds)}
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" iconLeft={<X className="size-4" />} onClick={clearSelection}>
                  Clear
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-faint">
                Shortcuts: <kbd>Ctrl+C</kbd> copy · <kbd>Ctrl+V</kbd> paste · <kbd>Del</kbd> delete ·{' '}
                <kbd>Esc</kbd> clear. Drag any selected card to move the whole group; Shift-drag a box
                to add more steps to the selection.
              </p>
            </div>
          ) : (
            <NodeEditorPanel
              schema={schema}
              selectedId={selectedId}
              issues={issues}
              description={description}
              connect={connect}
              onChangeDescription={v => {
                setDescription(v);
                setDirty(true);
              }}
              onPatchNode={patchNode}
              onStartConnect={startConnect}
              onSelect={selectNode}
            />
          )}
        </aside>

        <FlowCanvas
          schema={schema}
          selectedIds={selectedIds}
          connect={connect}
          onSelect={cardSelect}
          onClearSelection={clearSelection}
          onMarqueeSelect={marqueeSelect}
          onMoveNode={moveNode}
          onConnectTarget={connectTarget}
          onCancelConnect={cancelConnect}
          onDuplicate={duplicate}
          onDelete={deleteNode}
          onSetStart={setStart}
          onAddFirst={addQuestion}
        />
      </div>
    </div>
  );
};

export default FlowBuilderPage;
