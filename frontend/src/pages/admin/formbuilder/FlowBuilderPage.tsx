import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Layers, Plus, Save } from 'lucide-react';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connect, setConnect] = useState<ConnectRequest | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const validKey = !!formKey && isFlowFormKey(formKey);
  useDirtyGuard(dirty, LEAVE_MESSAGE);

  // Latest schema for stable callbacks that need to read it.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

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
        setSelectedId(null);
        setConnect(null);
        setDirty(false);
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
  const patchSchema = useCallback((fn: (s: FlowSchema) => FlowSchema) => {
    const next = fn(schemaRef.current);
    if (next === schemaRef.current) return;
    schemaRef.current = next;
    setSchema(next);
    setDirty(true);
  }, []);

  const patchNode = useCallback(
    (id: string, patch: NodePatch) => {
      patchSchema(s => {
        const node = s.nodes[id];
        if (!node) return s;
        return { ...s, nodes: { ...s.nodes, [id]: { ...node, ...patch } as FlowNode } };
      });
    },
    [patchSchema],
  );

  const moveNode = useCallback(
    (id: string, position: { x: number; y: number }) => {
      patchSchema(s => {
        const node = s.nodes[id];
        if (!node || (node.position.x === position.x && node.position.y === position.y)) return s;
        return { ...s, nodes: { ...s.nodes, [id]: { ...node, position } as FlowNode } };
      });
    },
    [patchSchema],
  );

  const addQuestion = useCallback(() => {
    const node = makeQuestionNode(spawnPosition(schemaRef.current));
    patchSchema(s => ({ startNodeId: s.startNodeId ?? node.id, nodes: { ...s.nodes, [node.id]: node } }));
    setSelectedId(node.id);
  }, [patchSchema]);

  const addSection = useCallback(() => {
    const node = makeSectionNode(spawnPosition(schemaRef.current));
    patchSchema(s => ({ startNodeId: s.startNodeId ?? node.id, nodes: { ...s.nodes, [node.id]: node } }));
    setSelectedId(node.id);
  }, [patchSchema]);

  const duplicate = useCallback(
    (id: string) => {
      const src = schemaRef.current.nodes[id];
      if (!src) return;
      const copy = duplicateNode(src);
      patchSchema(s => ({ ...s, nodes: { ...s.nodes, [copy.id]: copy } }));
      setSelectedId(copy.id);
    },
    [patchSchema],
  );

  const deleteNode = useCallback(
    (id: string) => {
      if (!window.confirm('Delete this step? Connections pointing to it will be cleared.')) return;
      setConnect(null);
      setSelectedId(cur => (cur === id ? null : cur));
      patchSchema(s => {
        const nodes: Record<string, FlowNode> = {};
        for (const [key, n] of Object.entries(s.nodes)) {
          if (key === id) continue;
          if (n.kind === 'question') {
            let q = n;
            if (q.next === id) q = { ...q, next: null };
            if (q.options.some(o => o.next === id)) {
              q = { ...q, options: q.options.map(o => (o.next === id ? { ...o, next: null } : o)) };
            }
            nodes[key] = q;
          } else {
            nodes[key] = n.next === id ? { ...n, next: null } : n;
          }
        }
        const remaining = Object.keys(nodes);
        const startNodeId = s.startNodeId === id ? remaining[0] ?? null : s.startNodeId;
        return { startNodeId, nodes };
      });
    },
    [patchSchema],
  );

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

  const selectIssue = useCallback((nodeId: string | null) => setSelectedId(nodeId), []);
  const selectNode = useCallback((id: string | null) => setSelectedId(id), []);
  const startConnect = useCallback((req: ConnectRequest) => setConnect(req), []);

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
        </aside>

        <FlowCanvas
          schema={schema}
          selectedId={selectedId}
          connect={connect}
          onSelect={selectNode}
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
