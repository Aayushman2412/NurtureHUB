import React from 'react';
import { useTranslation } from 'react-i18next';
import { DateInput, Select } from '../ui';
import { inputClasses } from '../ui/Input';
import type { FlowMatrixNode, MatrixAnswer, MatrixColumn } from '../../lib/flowTypes';
import { numberFlagState } from '../../lib/numericField';

/**
 * Learner-facing render of a multi-dropdown matrix: rows (subjects) × columns
 * (dropdowns/inputs). Mirrors the Cuedwell protein-intake grid. Each cell edit
 * calls onChange(rowId, colId, value); the parent stores the whole grid as one
 * JSON-encoded answer value.
 *
 * Column behaviours the admin controls per column:
 *  - learnerHidden: the column is not rendered and collects nothing;
 *  - zeroesRow (frequency-style): when its value is 0, the row's other input
 *    columns are auto-filled with "0" and locked (PCA "0 days" skip rule).
 */
interface MatrixStepCardProps {
  node: FlowMatrixNode;
  value: MatrixAnswer;
  onChange: (rowId: string, colId: string, value: string) => void;
}

const isZero = (v: string | undefined): boolean => v !== undefined && v !== '' && parseFloat(v) === 0;

const Cell: React.FC<{
  col: MatrixColumn;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}> = ({ col, value, disabled = false, onChange }) => {
  const { t } = useTranslation('assessments');

  if (col.type === 'dropdown') {
    return (
      <Select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        <option value="">{t('runner.selectPlaceholder')}</option>
        {(col.options ?? []).map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  if (col.type === 'date') {
    return <DateInput value={value} onChange={onChange} disabled={disabled} />;
  }
  if (col.type === 'datetime') {
    return (
      <input
        type="datetime-local"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className={inputClasses(false, false)}
      />
    );
  }
  if (col.type === 'number') {
    const flag = numberFlagState(value, col.numeric);
    return (
      <div>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className={inputClasses(!!flag, false)}
        />
        {flag && <p className="mt-1 text-xs text-error-600">{t(`runner.${flag.key}`, flag.params)}</p>}
      </div>
    );
  }
  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={inputClasses(false, false)}
    />
  );
};

const MatrixStepCard: React.FC<MatrixStepCardProps> = ({ node, value, onChange }) => {
  const columns = node.columns.filter(c => !c.learnerHidden);
  const zeroCol = columns.find(c => c.zeroesRow);

  /** When the frequency-style column is set to 0, zero-fill and lock the row's
   *  other input columns; clearing/raising it unlocks them (values kept). */
  const handleChange = (rowId: string, col: MatrixColumn, v: string) => {
    onChange(rowId, col.id, v);
    if (col.zeroesRow && isZero(v)) {
      for (const other of columns) {
        if (other.id !== col.id && other.type !== 'text') onChange(rowId, other.id, '0');
      }
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-border bg-surface-sunken px-3 py-2.5 text-left" />
            {columns.map(col => (
              <th
                key={col.id}
                className="border-b border-border bg-surface-sunken px-3 py-2.5 text-center align-bottom font-semibold text-ink"
              >
                {col.label}
                {col.required && <span className="ml-0.5 text-error-600">*</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map(row => {
            const rowZeroed = zeroCol ? isZero(value[row.id]?.[zeroCol.id]) : false;
            return (
              <tr key={row.id} className="align-top">
                <td className="border-b border-border px-3 py-3 text-left font-medium text-ink">
                  {row.label}
                  {row.helpText && <span className="block text-xs font-normal text-ink-muted">{row.helpText}</span>}
                </td>
                {columns.map(col => (
                  <td key={col.id} className="border-b border-border px-3 py-3">
                    <Cell
                      col={col}
                      value={value[row.id]?.[col.id] ?? ''}
                      disabled={rowZeroed && !col.zeroesRow && col.type !== 'text'}
                      onChange={v => handleChange(row.id, col, v)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default MatrixStepCard;
