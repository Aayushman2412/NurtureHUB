import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Layers,
  Plus,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { flattenAnswerable } from '../../lib/flowGraph';
import type { FlowIssue } from '../../lib/flowGraph';
import type { FlowQuestionNode, FlowSchema, FlowSectionNode } from '../../lib/flowTypes';
import { resolveDisplay, resolveVerdicts } from '../../lib/flowTypes';
import { Badge, FieldLabel, Input } from '../ui';
import { inputClasses } from '../ui/Input';
import { cn } from '../../utils/cn';
import QuestionEditor from './QuestionEditor';
import TargetPicker from './TargetPicker';
import { makeSectionChild } from './factories';
import { EDGE_COLORS, QUESTION_TYPE_LABELS, issueCounts, nodeTitle, targetOptionsFor } from './constants';
import type { ConnectRequest, NodePatch, QuestionPatch } from './constants';

export interface NodeEditorPanelProps {
  schema: FlowSchema;
  selectedId: string | null;
  issues: FlowIssue[];
  description: string;
  connect: ConnectRequest | null;
  onChangeDescription: (value: string) => void;
  onPatchNode: (id: string, patch: NodePatch) => void;
  onStartConnect: (req: ConnectRequest) => void;
  onSelect: (id: string | null) => void;
}

const PanelHeader: React.FC<{ label: string; kind: 'question' | 'section'; onClose: () => void }> = ({
  label,
  kind,
  onClose,
}) => (
  <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
    <div className="flex items-center gap-2">
      {kind === 'section' ? (
        <Layers className="size-4 text-sage-600 dark:text-sage-300" />
      ) : (
        <CircleHelp className="size-4 text-primary" />
      )}
      <h3 className="font-display text-sm font-bold text-ink">{label}</h3>
    </div>
    <button
      type="button"
      onClick={onClose}
      title="Close editor"
      className="flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-surface-sunken hover:text-ink cursor-pointer"
    >
      <X className="size-4" />
    </button>
  </div>
);

/* ── Form-level info (nothing selected) ────────────────────────────────────── */

const LegendRow: React.FC<{ swatch: React.ReactNode; children: React.ReactNode }> = ({ swatch, children }) => (
  <li className="flex items-center gap-2.5 text-xs text-ink-muted">
    <span className="flex w-6 shrink-0 items-center justify-center">{swatch}</span>
    {children}
  </li>
);

const FormInfoPanel: React.FC<{
  schema: FlowSchema;
  issues: FlowIssue[];
  description: string;
  onChangeDescription: (value: string) => void;
  onSelect: (id: string | null) => void;
}> = ({ schema, issues, description, onChangeDescription, onSelect }) => {
  const nodes = Object.values(schema.nodes);
  const sections = nodes.filter(n => n.kind === 'section').length;
  const steps = flattenAnswerable(schema).length;
  const { errors, warnings } = issueCounts(issues);

  return (
    <div className="space-y-5 p-4">
      <div>
        <h3 className="font-display text-sm font-bold text-ink">Form overview</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Select a card on the canvas to edit it, drag cards to arrange the flow, and use the
          crosshair buttons to connect answers to follow-up steps.
        </p>
      </div>

      <div>
        <FieldLabel size="sm">Description</FieldLabel>
        <textarea
          rows={3}
          className={cn(inputClasses(), 'resize-y')}
          value={description}
          onChange={e => onChangeDescription(e.target.value)}
          placeholder="A short summary of what this assessment covers."
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Cards', value: nodes.length },
          { label: 'Sections', value: sections },
          { label: 'Steps', value: steps },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-surface-sunken/50 px-2 py-2.5">
            <div className="font-display text-lg font-bold text-ink">{s.value}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{s.label}</div>
          </div>
        ))}
      </div>

      <div>
        <FieldLabel size="sm">Validation</FieldLabel>
        {issues.length === 0 ? (
          <p className="rounded-lg bg-success-50 px-3 py-2 text-xs font-semibold text-success-600 dark:bg-success-500/10 dark:text-success-500">
            No issues — this flow is ready to publish.
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] text-ink-faint">
              {errors > 0 && `${errors} error${errors > 1 ? 's' : ''}`}
              {errors > 0 && warnings > 0 && ' · '}
              {warnings > 0 && `${warnings} warning${warnings > 1 ? 's' : ''}`}
            </p>
            <ul className="space-y-1">
              {issues.slice(0, 6).map((issue, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onSelect(issue.nodeId)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-surface-sunken cursor-pointer"
                  >
                    {issue.level === 'error' ? (
                      <XCircle className="mt-px size-3.5 shrink-0 text-rose-500" />
                    ) : (
                      <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-500" />
                    )}
                    {issue.message}
                  </button>
                </li>
              ))}
              {issues.length > 6 && (
                <li className="px-2 text-[11px] text-ink-faint">…and {issues.length - 6} more</li>
              )}
            </ul>
          </>
        )}
      </div>

      <div>
        <FieldLabel size="sm">Legend</FieldLabel>
        <ul className="space-y-2">
          <LegendRow swatch={<span className="size-2.5 rounded-full bg-emerald-500" />}>
            Green — practice as per LAP
          </LegendRow>
          <LegendRow swatch={<span className="size-2.5 rounded-full bg-rose-500" />}>
            Red — needs coaching, can queue actions
          </LegendRow>
          <LegendRow swatch={<span className="size-2.5 rounded-full border-[1.5px] border-ink-faint" />}>
            Neutral — informational answer
          </LegendRow>
          <LegendRow
            swatch={<span className="h-0.5 w-6 rounded-full" style={{ backgroundColor: EDGE_COLORS.default }} />}
          >
            Default path between steps
          </LegendRow>
          <LegendRow
            swatch={<span className="h-0.5 w-6 rounded-full" style={{ backgroundColor: EDGE_COLORS.green }} />}
          >
            Answer branch, colored by its verdict
          </LegendRow>
          <LegendRow
            swatch={
              <span className="rounded-full bg-primary px-1.5 py-px text-[8px] font-extrabold uppercase text-primary-fg">
                Start
              </span>
            }
          >
            First step learners see
          </LegendRow>
        </ul>
      </div>
    </div>
  );
};

/* ── Section node editor ───────────────────────────────────────────────────── */

const childIconBtn =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:opacity-35 disabled:pointer-events-none';

const SectionPanel: React.FC<{
  node: FlowSectionNode;
  schema: FlowSchema;
  connect: ConnectRequest | null;
  onPatchNode: (id: string, patch: NodePatch) => void;
  onStartConnect: (req: ConnectRequest) => void;
  onSelect: (id: string | null) => void;
}> = ({ node, schema, connect, onPatchNode, onStartConnect, onSelect }) => {
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);
  const targets = targetOptionsFor(schema, node.id);

  const patchChildren = (children: FlowSectionNode['children']) => onPatchNode(node.id, { children });

  const patchChild = (childId: string, patch: QuestionPatch) =>
    patchChildren(node.children.map(c => (c.id === childId ? { ...c, ...patch } : c)));

  const addChild = () => {
    const child = makeSectionChild();
    patchChildren([...node.children, child]);
    setExpandedChildId(child.id);
  };

  const removeChild = (childId: string) => {
    if (!window.confirm('Remove this question from the section?')) return;
    patchChildren(node.children.filter(c => c.id !== childId));
  };

  const moveChild = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= node.children.length) return;
    const children = [...node.children];
    [children[i], children[target]] = [children[target], children[i]];
    patchChildren(children);
  };

  return (
    <div>
      <PanelHeader label="Common section" kind="section" onClose={() => onSelect(null)} />
      <div className="space-y-4 p-4">
        <div>
          <FieldLabel size="sm">Section title</FieldLabel>
          <Input
            value={node.title}
            onChange={e => onPatchNode(node.id, { title: e.target.value })}
            placeholder="e.g. Preparation checks"
          />
        </div>

        <TargetPicker
          label="After this section"
          value={node.next}
          options={targets}
          onChange={next => onPatchNode(node.id, { next })}
          onStartConnect={() => onStartConnect({ nodeId: node.id, optionId: null })}
          connectActive={!!connect && connect.nodeId === node.id && connect.optionId === null}
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <FieldLabel size="sm" className="mb-0">
              Questions in this section
            </FieldLabel>
            <span className="text-[11px] text-ink-faint">{node.children.length}</span>
          </div>
          <p className="mb-2 text-[11px] leading-snug text-ink-faint">
            Section questions are asked in order and cannot branch — the flow continues after the
            section ends.
          </p>
          <div className="space-y-2">
            {node.children.map((child, i) => {
              const expanded = expandedChildId === child.id;
              return (
                <div
                  key={child.id}
                  className={cn(
                    'rounded-lg border bg-surface transition-colors',
                    expanded ? 'border-border-strong/70 shadow-(--shadow-card)' : 'border-border',
                  )}
                >
                  <div className="flex items-center gap-2 py-2 pl-2.5 pr-1.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-surface-sunken text-[10px] font-bold text-ink-muted">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedChildId(cur => (cur === child.id ? null : child.id))}
                      className="min-w-0 flex-1 cursor-pointer text-left"
                    >
                      <span className="block truncate text-[13px] font-semibold text-ink">
                        {nodeTitle(child)}
                      </span>
                      <span className="text-[10px] text-ink-faint">
                        {QUESTION_TYPE_LABELS[child.questionType]}
                        {child.options.length > 0 && ` · ${child.options.length} options`}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        title="Move up"
                        onClick={() => moveChild(i, -1)}
                        disabled={i === 0}
                        className={childIconBtn}
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        onClick={() => moveChild(i, 1)}
                        disabled={i === node.children.length - 1}
                        className={childIconBtn}
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Remove question"
                        onClick={() => removeChild(child.id)}
                        className={cn(childIconBtn, 'hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10')}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title={expanded ? 'Collapse' : 'Edit question'}
                        onClick={() => setExpandedChildId(cur => (cur === child.id ? null : child.id))}
                        className={childIconBtn}
                      >
                        <ChevronRight
                          className={cn('size-4 transition-transform duration-150', expanded && 'rotate-90')}
                        />
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-border p-3">
                      <QuestionEditor
                        verdictDefs={resolveVerdicts(schema.verdicts)}
                        formDisplay={resolveDisplay(schema.display)}
                        question={child}
                        allowBranching={false}
                        onPatch={patch => patchChild(child.id, patch)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addChild}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong/70 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-primary hover:text-primary cursor-pointer"
          >
            <Plus className="size-4" /> Add question
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Question node editor ──────────────────────────────────────────────────── */

const QuestionPanel: React.FC<{
  node: FlowQuestionNode;
  schema: FlowSchema;
  connect: ConnectRequest | null;
  onPatchNode: (id: string, patch: NodePatch) => void;
  onStartConnect: (req: ConnectRequest) => void;
  onSelect: (id: string | null) => void;
}> = ({ node, schema, connect, onPatchNode, onStartConnect, onSelect }) => {
  const targets = targetOptionsFor(schema, node.id);
  const connecting = connect && connect.nodeId === node.id ? connect : null;

  return (
    <div>
      <PanelHeader label="Question" kind="question" onClose={() => onSelect(null)} />
      <div className="p-4">
        <div className="mb-3">
          <Badge variant="coral">{QUESTION_TYPE_LABELS[node.questionType]}</Badge>
        </div>
        <QuestionEditor
          verdictDefs={resolveVerdicts(schema.verdicts)}
          formDisplay={resolveDisplay(schema.display)}
          question={node}
          allowBranching
          branchTargets={targets}
          connectingOptionId={connecting ? connecting.optionId : undefined}
          onPatch={patch => onPatchNode(node.id, patch)}
          onStartConnect={optionId => onStartConnect({ nodeId: node.id, optionId })}
          defaultNextSlot={
            <TargetPicker
              label="Default next step"
              value={node.next}
              options={targets}
              onChange={next => onPatchNode(node.id, { next })}
              onStartConnect={() => onStartConnect({ nodeId: node.id, optionId: null })}
              connectActive={!!connecting && connecting.optionId === null}
            />
          }
        />
      </div>
    </div>
  );
};

/* ── Host ──────────────────────────────────────────────────────────────────── */

/** Left editor panel: form info when nothing is selected, else the node editor. */
const NodeEditorPanel: React.FC<NodeEditorPanelProps> = ({
  schema,
  selectedId,
  issues,
  description,
  connect,
  onChangeDescription,
  onPatchNode,
  onStartConnect,
  onSelect,
}) => {
  const node = selectedId ? schema.nodes[selectedId] : undefined;

  if (!node) {
    return (
      <FormInfoPanel
        schema={schema}
        issues={issues}
        description={description}
        onChangeDescription={onChangeDescription}
        onSelect={onSelect}
      />
    );
  }

  return node.kind === 'section' ? (
    <SectionPanel
      key={node.id}
      node={node}
      schema={schema}
      connect={connect}
      onPatchNode={onPatchNode}
      onStartConnect={onStartConnect}
      onSelect={onSelect}
    />
  ) : (
    <QuestionPanel
      key={node.id}
      node={node}
      schema={schema}
      connect={connect}
      onPatchNode={onPatchNode}
      onStartConnect={onStartConnect}
      onSelect={onSelect}
    />
  );
};

export default NodeEditorPanel;
