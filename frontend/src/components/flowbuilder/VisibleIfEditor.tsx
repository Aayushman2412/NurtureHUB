import React from 'react';
import { Eye } from 'lucide-react';
import type { FlowSchema, VisibleIf } from '../../lib/flowTypes';
import { isQuestionNode } from '../../lib/flowTypes';
import { FieldLabel, Select } from '../ui';
import { cn } from '../../utils/cn';

/**
 * "Visible only when…" rule editor, shared by every top-level node panel.
 * The rule gates the node on a previous single/multi question's answer: the
 * node is shown only when the learner picked at least one of the ticked
 * options. The runner walks straight through hidden nodes, so the default
 * next-chain stays intact (no branch surgery needed).
 */
export interface VisibleIfEditorProps {
  schema: FlowSchema;
  /** The node being edited (excluded from the source list). */
  nodeId: string;
  value: VisibleIf | null | undefined;
  onChange: (value: VisibleIf | null) => void;
}

const VisibleIfEditor: React.FC<VisibleIfEditorProps> = ({ schema, nodeId, value, onChange }) => {
  const sources = Object.values(schema.nodes).filter(
    (n): n is Extract<typeof n, { kind: 'question' }> =>
      n.id !== nodeId &&
      isQuestionNode(n) &&
      (n.questionType === 'single' || n.questionType === 'multi'),
  );
  if (sources.length === 0 && !value) return null;

  const source = value ? schema.nodes[value.nodeId] : undefined;
  const sourceOptions = source && isQuestionNode(source) ? source.options : [];

  const toggleOption = (optionId: string) => {
    if (!value) return;
    const anyOf = value.anyOf.includes(optionId)
      ? value.anyOf.filter(id => id !== optionId)
      : [...value.anyOf, optionId];
    onChange({ ...value, anyOf });
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <FieldLabel size="sm" className="mb-1.5 flex items-center gap-1.5">
        <Eye className="size-3.5" /> Visibility
      </FieldLabel>
      <Select
        value={value?.nodeId ?? ''}
        onChange={e => {
          const id = e.target.value;
          onChange(id ? { nodeId: id, anyOf: [] } : null);
        }}
      >
        <option value="">Always visible (default)</option>
        {sources.map(q => (
          <option key={q.id} value={q.id}>
            Only when "{q.title || 'Untitled question'}" is…
          </option>
        ))}
      </Select>

      {value && (
        <>
          <p className="mt-2 text-[11px] leading-snug text-ink-muted">
            Shown when the answer includes any ticked option. Hidden steps are skipped —
            the flow continues at this step's next.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sourceOptions.length === 0 && (
              <span className="text-[11px] text-error-600">That question no longer exists or has no options.</span>
            )}
            {sourceOptions.map(o => {
              const selected = value.anyOf.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggleOption(o.id)}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    selected
                      ? 'border-primary bg-coral-50 text-primary-ink dark:bg-coral-500/15'
                      : 'border-border text-ink-muted hover:border-border-strong',
                  )}
                >
                  {o.label || o.id}
                </button>
              );
            })}
          </div>
          {value.anyOf.length === 0 && (
            <p className="mt-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-500">
              No options ticked — this step would never be shown.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default VisibleIfEditor;
