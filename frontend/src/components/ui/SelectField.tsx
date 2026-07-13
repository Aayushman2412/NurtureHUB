import React from 'react';
import { Field } from './Field';
import Select from './Select';

export interface SelectFieldOption {
  value: number | string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  /** Inline validation message; also drives the control's error styling. */
  error?: string;
}

/** Field + Select composed together — the common labelled-dropdown pattern. */
const SelectField: React.FC<SelectFieldProps> = ({
  label, value, onChange, options, placeholder, disabled = false, required = true, error,
}) => (
  <Field label={label} error={error}>
    <Select value={value} onChange={e => onChange(e.target.value)} required={required}
      disabled={disabled} error={!!error}>
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  </Field>
);

export default SelectField;
