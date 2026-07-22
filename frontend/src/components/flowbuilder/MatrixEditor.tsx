import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { FlowMatrixNode, MatrixColumn, NumericRange } from '../../lib/flowTypes';
import { Checkbox, FieldLabel, Input, Select } from '../ui';
import { cn } from '../../utils/cn';
import { makeMatrixColumn, makeMatrixRow } from './factories';

/**
 * Admin editor for a multi-dropdown matrix: the row list (subjects) + the
 * column list (each a typed input — dropdown / number / text / date /
 * date-time). Dropdown columns get an editable option list; number columns get
 * the numerical decimals + flag-range settings.
 */
interface MatrixEditorProps {
  node: FlowMatrixNode;
  onPatch: (patch: Partial<Pick<FlowMatrixNode, 'rows' | 'columns'>>) => void;
}

const COLUMN_TYPES: { value: MatrixColumn['type']; label: string }[] = [
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'number', label: 'Numerical' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
];

const iconBtn =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:opacity-35 disabled:pointer-events-none';

const numInput = (raw: string): number | null => {
  const v = raw.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ColumnEditor: React.FC<{
  col: MatrixColumn;
  index: number;
  count: number;
  onChange: (col: MatrixColumn) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}> = ({ col, index, count, onChange, onRemove, onMove }) => {
  const [open, setOpen] = useState(false);
  const numeric: NumericRange = col.numeric ?? {};
  const setNumeric = (patch: Partial<NumericRange>) =>
    onChange({ ...col, numeric: { ...numeric, ...patch } });

  const changeType = (type: MatrixColumn['type']) =>
    onChange({
      ...col,
      type,
      options: type === 'dropdown' ? (col.options ?? []) : null,
      numeric: type === 'number' ? (col.numeric ?? { decimals: 1 }) : null,
    });

  const setOptionsText = (text: string) => {
    const options = text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => ({ label: l, value: l }));
    onChange({ ...col, options });
  };

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 py-2 pl-2.5 pr-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-surface-sunken text-[10px] font-bold text-ink-muted">
          {index + 1}
        </span>
        <button type="button" onClick={() => setOpen(o => !o)} className="min-w-0 flex-1 cursor-pointer text-left">
          <span className="block truncate text-[13px] font-semibold text-ink">{col.label || 'Untitled column'}</span>
          <span className="text-[10px] text-ink-faint">
            {COLUMN_TYPES.find(c => c.value === col.type)?.label}
            {col.required && ' · required'}
          </span>
        </button>
        <button type="button" title="Move up" onClick={() => onMove(-1)} disabled={index === 0} className={iconBtn}>
          <ChevronUp className="size-3.5" />
        </button>
        <button type="button" title="Move down" onClick={() => onMove(1)} disabled={index === count - 1} className={iconBtn}>
          <ChevronDown className="size-3.5" />
        </button>
        <button
          type="button"
          title="Remove column"
          onClick={onRemove}
          className={cn(iconBtn, 'hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="space-y-2.5 border-t border-border p-3">
          <div>
            <FieldLabel size="sm">Column heading</FieldLabel>
            <Input
              value={col.label}
              onChange={e => onChange({ ...col, label: e.target.value })}
              placeholder="e.g. Number of portions in last 24h"
            />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <FieldLabel size="sm">Input type</FieldLabel>
              <Select value={col.type} onChange={e => changeType(e.target.value as MatrixColumn['type'])}>
                {COLUMN_TYPES.map(c => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <Checkbox
              className="pb-2.5"
              label="Required"
              checked={col.required}
              onChange={e => onChange({ ...col, required: e.target.checked })}
            />
          </div>

          {col.type === 'dropdown' && (
            <div>
              <FieldLabel size="sm">Dropdown options (one per line)</FieldLabel>
              <textarea
                rows={4}
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={(col.options ?? []).map(o => o.label).join('\n')}
                onChange={e => setOptionsText(e.target.value)}
                placeholder={'0\n0.5\n1\n1.5\n2'}
              />
            </div>
          )}

          {col.type === 'number' && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <FieldLabel size="sm">Decimals</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  max={4}
                  value={numeric.decimals ?? ''}
                  onChange={e => setNumeric({ decimals: numInput(e.target.value) })}
                  placeholder="1"
                />
              </div>
              <div>
                <FieldLabel size="sm">Flag below</FieldLabel>
                <Input
                  type="number"
                  value={numeric.flagMin ?? ''}
                  onChange={e => setNumeric({ flagMin: numInput(e.target.value) })}
                  placeholder="min"
                />
              </div>
              <div>
                <FieldLabel size="sm">Flag above</FieldLabel>
                <Input
                  type="number"
                  value={numeric.flagMax ?? ''}
                  onChange={e => setNumeric({ flagMax: numInput(e.target.value) })}
                  placeholder="max"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MatrixEditor: React.FC<MatrixEditorProps> = ({ node, onPatch }) => {
  const setRows = (rows: FlowMatrixNode['rows']) => onPatch({ rows });
  const setColumns = (columns: FlowMatrixNode['columns']) => onPatch({ columns });

  const rowsText = node.rows.map(r => r.label).join('\n');
  const setRowsFromText = (text: string) => {
    // Keep only non-blank lines so a trailing/blank line never becomes a phantom
    // empty row in the runner. Existing row ids are reused positionally among the
    // kept lines (rename/append stay attached; large reorders may re-key — the
    // stored answer snapshots keep their own labels, so submitted data is safe).
    const labels = text.split('\n').map(l => l.trim());
    const kept = labels.filter(Boolean);
    const rows = kept.map((label, i) =>
      node.rows[i] ? { ...node.rows[i], label } : makeMatrixRow(label),
    );
    setRows(rows);
  };

  const moveColumn = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= node.columns.length) return;
    const columns = [...node.columns];
    [columns[i], columns[target]] = [columns[target], columns[i]];
    setColumns(columns);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <FieldLabel size="sm" className="mb-0">
            Rows (one subject per line)
          </FieldLabel>
          <span className="text-[11px] text-ink-faint">{node.rows.length}</span>
        </div>
        <textarea
          rows={5}
          className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={rowsText}
          onChange={e => setRowsFromText(e.target.value)}
          placeholder={'1 roti or chapati (6 g protein)\n1 cup of rice (5 g protein)'}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <FieldLabel size="sm" className="mb-0">
            Columns
          </FieldLabel>
          <span className="text-[11px] text-ink-faint">{node.columns.length}</span>
        </div>
        <div className="space-y-2">
          {node.columns.map((col, i) => (
            <ColumnEditor
              key={col.id}
              col={col}
              index={i}
              count={node.columns.length}
              onChange={c => setColumns(node.columns.map((x, xi) => (xi === i ? c : x)))}
              onRemove={() => setColumns(node.columns.filter((_, xi) => xi !== i))}
              onMove={dir => moveColumn(i, dir)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setColumns([...node.columns, makeMatrixColumn('', 'dropdown')])}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong/70 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-primary hover:text-primary cursor-pointer"
        >
          <Plus className="size-4" /> Add column
        </button>
      </div>
    </div>
  );
};

export default MatrixEditor;
