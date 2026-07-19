import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BoxSelect, ClipboardPaste, Copy, Layers, Plus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react';
import { adminGetForm, adminSaveForm } from '../../../api/forms';
import { validateFlow } from '../../../lib/flowGraph';
import { emptyFlowSchema, isFlowFormKey } from '../../../lib/flowTypes';
import type { FlowNode, FlowSchema, FormDefinition } from '../../../lib/flowTypes';
import { useToast } from '../../../context/ToastContext';
import { Alert, Badge, Button, PageLoader } from '../../../components/ui';
import FlowCanvas from '../../../components/flowbuilder/FlowCanvas';
import NodeEditorPanel from '../../../components/flowbuilder/NodeEditorPanel';
import ValidationChip from '../../../components/flowbuilder/ValidationChip';
import {
  cloneNodesForPaste,
  duplicateNode,
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
            ? { startNodeId: s.startNodeId ?? null, nodes: s.nodes }
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
