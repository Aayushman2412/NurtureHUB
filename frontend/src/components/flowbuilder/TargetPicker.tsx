import React from 'react';
import { Crosshair } from 'lucide-react';
import { FieldLabel, Select } from '../ui';
import { cn } from '../../utils/cn';
import { END_TARGET } from './constants';
import type { TargetOption } from './constants';

export interface TargetPickerProps {
  label: string;
  /** Target node id, or null for "end of form". */
  value: string | null;
  options: TargetOption[];
  onChange: (next: string | null) => void;
  /** When provided, renders the crosshair button that enters connect mode. */
  onStartConnect?: () => void;
  /** True while THIS picker's connect mode is active (highlights the button). */
  connectActive?: boolean;
  className?: string;
}

/** Labelled "where to next" dropdown + optional click-to-connect crosshair. */
const TargetPicker: React.FC<TargetPickerProps> = ({
  label,
  value,
  options,
  onChange,
  onStartConnect,
  connectActive,
  className,
}) => (
  <div className={className}>
    <FieldLabel size="sm">{label}</FieldLabel>
    <div className="flex items-center gap-1.5">
      <Select
        value={value ?? END_TARGET}
        onChange={e => onChange(e.target.value === END_TARGET ? null : e.target.value)}
      >
        <option value={END_TARGET}>— End of form —</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {onStartConnect && (
        <button
          type="button"
          onClick={onStartConnect}
          title="Pick a target on the canvas"
          className={cn(
            'flex size-9.5 shrink-0 items-center justify-center rounded-lg border transition-colors cursor-pointer',
            connectActive
              ? 'border-primary bg-coral-50 text-primary ring-2 ring-primary/25 dark:bg-coral-500/15'
              : 'border-border-strong/60 text-ink-muted hover:border-primary hover:text-primary',
          )}
        >
          <Crosshair className="size-4" />
        </button>
      )}
    </div>
  </div>
);

export default TargetPicker;
