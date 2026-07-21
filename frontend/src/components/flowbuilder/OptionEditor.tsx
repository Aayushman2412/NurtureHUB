import React from 'react';
import { ChevronDown, ChevronRight, ChevronUp, CornerDownRight, Image as ImageIcon, Trash2, Zap } from 'lucide-react';
import type { FlowOption, Verdict, VerdictDef } from '../../lib/flowTypes';
import { findVerdict } from '../../lib/flowTypes';
import { FieldLabel, Input } from '../ui';
import { cn } from '../../utils/cn';
import ActionEditor from './ActionEditor';
import MediaPicker from './MediaPicker';
import TargetPicker from './TargetPicker';
import { verdictEdgeColor } from './constants';
import type { TargetOption } from './constants';

const ACTION_SUMMARY: Record<string, string> = {
  notify: 'Notification',
  youtube: 'YouTube',
  video: 'Video',
  info: 'Info',
};

export const VerdictDot: React.FC<{
  verdict: Verdict;
  verdictDefs?: VerdictDef[];
  className?: string;
}> = ({ verdict, verdictDefs, className }) =>
  verdict === null ? (
    <span className={cn('inline-block size-2.5 shrink-0 rounded-full border-[1.5px] border-ink-faint', className)} />
  ) : (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: verdictEdgeColor(verdict, verdictDefs) }}
    />
  );

export interface OptionEditorProps {
  option: FlowOption;
  index: number;
  count: number;
  /** The form's verdict vocabulary (custom verdicts included). */
  verdictDefs: VerdictDef[];
  /** True on single-select top-level questions — enables the branch picker. */
  allowBranch: boolean;
  branchTargets: TargetOption[];
  /** True while connect mode is armed for this option's branch. */
  connecting: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (option: FlowOption) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onStartConnect?: () => void;
}

const iconBtn =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:opacity-35 disabled:pointer-events-none';

/** One answer option: label, verdict, media, action, and (single-select) branch. */
const OptionEditor: React.FC<OptionEditorProps> = ({
  option,
  index,
  count,
  verdictDefs,
  allowBranch,
  branchTargets,
  connecting,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMove,
  onStartConnect,
}) => {
  const patch = (p: Partial<FlowOption>) => onChange({ ...option, ...p });

  const branchLabel = option.next
    ? branchTargets.find(t => t.value === option.next)?.label ?? 'Missing step'
    : null;
  const summaryBits: React.ReactNode[] = [];
  if (option.media.length > 0) {
    summaryBits.push(
      <span key="media" className="inline-flex items-center gap-1">
        <ImageIcon className="size-3" /> {option.media.length}
      </span>,
    );
  }
  if (option.action.type !== 'none') {
    summaryBits.push(
      <span key="action" className="inline-flex items-center gap-1">
        <Zap className="size-3" /> {ACTION_SUMMARY[option.action.type]}
      </span>,
    );
  }
  if (branchLabel) {
    summaryBits.push(
      <span key="branch" className="inline-flex min-w-0 items-center gap-1">
        <CornerDownRight className="size-3 shrink-0" />
        <span className="truncate">{branchLabel}</span>
      </span>,
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-surface transition-colors',
        expanded ? 'border-border-strong/70 shadow-(--shadow-card)' : 'border-border',
        connecting && 'ring-2 ring-primary/40',
      )}
    >
      <div className="flex items-center gap-2 py-2 pl-2.5 pr-1.5">
        <VerdictDot verdict={option.verdict} verdictDefs={verdictDefs} />
        <Input
          value={option.label}
          onChange={e => patch({ label: e.target.value })}
          placeholder={`Option ${index + 1}`}
          className="py-1.5 text-[13px]"
        />
        <div className="flex shrink-0 items-center">
          <button type="button" title="Move up" onClick={() => onMove(-1)} disabled={index === 0} className={iconBtn}>
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            title="Move down"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            className={iconBtn}
          >
            <ChevronDown className="size-3.5" />
          </button>
          <button
            type="button"
            title="Remove option"
            onClick={onRemove}
            className={cn(iconBtn, 'hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10')}
          >
            <Trash2 className="size-3.5" />
          </button>
          <button type="button" title={expanded ? 'Collapse' : 'Edit details'} onClick={onToggle} className={iconBtn}>
            <ChevronRight className={cn('size-4 transition-transform duration-150', expanded && 'rotate-90')} />
          </button>
        </div>
      </div>

      {!expanded && summaryBits.length > 0 && (
        <div className="flex items-center gap-3 overflow-hidden px-2.5 pb-2 text-[10px] font-semibold text-ink-faint">
          {summaryBits}
        </div>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <div>
            <FieldLabel size="sm">Verdict</FieldLabel>
            {/* Built from the form's verdict list, so custom verdicts appear here.
                "Neutral" is the absence of a verdict (null) and is always offered. */}
            <div className="flex flex-wrap gap-1.5">
              {[null, ...verdictDefs.map(d => d.id)].map(id => {
                const def = findVerdict(verdictDefs, id);
                const active = option.verdict === id;
                return (
                  <button
                    key={String(id)}
                    type="button"
                    onClick={() => patch({ verdict: id })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer',
                      active
                        ? 'border-transparent text-white'
                        : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
                    )}
                    style={active ? { backgroundColor: def?.color ?? 'var(--color-cream-600)' } : undefined}
                  >
                    <VerdictDot verdict={id} verdictDefs={verdictDefs} />
                    {def ? def.label : 'Neutral'}
                  </button>
                );
              })}
            </div>
          </div>

          <MediaPicker media={option.media} onChange={media => patch({ media })} />

          <ActionEditor key={option.id} action={option.action} onChange={action => patch({ action })} />

          {allowBranch && (
            <TargetPicker
              label="Then go to"
              value={option.next}
              options={branchTargets}
              onChange={next => patch({ next })}
              onStartConnect={onStartConnect}
              connectActive={connecting}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default OptionEditor;
