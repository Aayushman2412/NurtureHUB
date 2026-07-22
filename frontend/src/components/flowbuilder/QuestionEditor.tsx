import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type {
  FlowDisplaySettings,
  FlowQuestionNode,
  FlowSectionChild,
  NumericRange,
  QuestionDisplayOverride,
  QuestionType,
  VerdictDef,
  VerdictTiming,
} from '../../lib/flowTypes';
import { Checkbox, FieldLabel, Input, Select } from '../ui';
import { inputClasses } from '../ui/Input';
import { cn } from '../../utils/cn';
import MediaPicker from './MediaPicker';
import OptionEditor from './OptionEditor';
import { makeOption } from './factories';
import { QUESTION_TYPE_LABELS } from './constants';
import type { QuestionPatch, TargetOption } from './constants';

export interface QuestionEditorProps {
  question: FlowQuestionNode | FlowSectionChild;
  /** The form's verdict vocabulary, for the per-option verdict picker. */
  verdictDefs: VerdictDef[];
  /** The form-level learner-view defaults this question can override. */
  formDisplay: FlowDisplaySettings;
  /** False for common-section children (no branching there). */
  allowBranching: boolean;
  branchTargets?: TargetOption[];
  /** Option id whose branch connect mode is armed (null = the node default). */
  connectingOptionId?: string | null;
  onPatch: (patch: QuestionPatch) => void;
  onStartConnect?: (optionId: string) => void;
  /** Rendered between the answer-type select and the options list (default-next picker). */
  defaultNextSlot?: React.ReactNode;
}

const QUESTION_TYPES = Object.entries(QUESTION_TYPE_LABELS) as [QuestionType, string][];

/** Shared editor for a question — used by top-level nodes and section children. */
const QuestionEditor: React.FC<QuestionEditorProps> = ({
  question,
  verdictDefs,
  formDisplay,
  allowBranching,
  branchTargets = [],
  connectingOptionId,
  onPatch,
  onStartConnect,
  defaultNextSlot,
}) => {
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const hasOptions = question.questionType === 'single' || question.questionType === 'multi';
  const branchable = allowBranching && question.questionType === 'single';

  // ── Per-question learner-view overrides ────────────────────────────────────
  // Unset keys inherit the form default; a cleared select removes its key so
  // the schema stays free of no-op overrides.
  const override: QuestionDisplayOverride = question.display ?? {};
  const overrideCount = (Object.keys(override) as (keyof QuestionDisplayOverride)[]).filter(
    k => override[k] != null,
  ).length;

  const setOverride = (patch: QuestionDisplayOverride) => {
    const next: QuestionDisplayOverride = { ...override, ...patch };
    (Object.keys(next) as (keyof QuestionDisplayOverride)[]).forEach(k => {
      if (next[k] == null) delete next[k];
    });
    onPatch({ display: Object.keys(next).length > 0 ? next : undefined });
  };

  type BoolOverrideKey = 'helpText' | 'questionMedia' | 'optionMedia' | 'actions';
  const boolOverrideSelect = (key: BoolOverrideKey, ariaLabel: string) => (
    <Select
      aria-label={ariaLabel}
      className="py-1.5 text-[12px]"
      value={override[key] == null ? '' : override[key] ? 'show' : 'hide'}
      onChange={e =>
        setOverride({ [key]: e.target.value === '' ? null : e.target.value === 'show' })
      }
    >
      <option value="">Form default ({formDisplay[key] ? 'shown' : 'hidden'})</option>
      <option value="show">Show</option>
      <option value="hide">Hide</option>
    </Select>
  );

  const TIMING_LABELS: Record<VerdictTiming, string> = {
    during: 'While answering',
    after: 'After submitting',
    never: 'Never',
  };

  const numeric: NumericRange = question.numeric ?? {};
  const setNumeric = (patch: Partial<NumericRange>) => onPatch({ numeric: { ...numeric, ...patch } });
  const numInput = (raw: string): number | null => {
    const v = raw.trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const changeType = (value: string) => {
    const questionType = value as QuestionType;
    if (questionType === question.questionType) return;
    if (questionType === 'text' || questionType === 'date' || questionType === 'number') {
      if (
        question.options.length > 0 &&
        !window.confirm('Text, date and numerical questions have no answer options — the existing options will be removed. Continue?')
      ) {
        return;
      }
      onPatch({
        questionType,
        options: [],
        numeric: questionType === 'number' ? (question.numeric ?? { decimals: 1 }) : null,
      });
      return;
    }
    // single/multi both need at least two options; seed them if switching from
    // an option-less type (text/date/number) so the question isn't left empty.
    const options =
      question.options.length > 0
        ? question.options.map(o => (questionType === 'multi' ? { ...o, next: null } : o))
        : [makeOption(), makeOption()];
    onPatch({ questionType, options, numeric: null });
  };

  const updateOption = (i: number, option: (typeof question.options)[number]) =>
    onPatch({ options: question.options.map((o, oi) => (oi === i ? option : o)) });

  const removeOption = (i: number) =>
    onPatch({ options: question.options.filter((_, oi) => oi !== i) });

  const moveOption = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= question.options.length) return;
    const options = [...question.options];
    [options[i], options[target]] = [options[target], options[i]];
    onPatch({ options });
  };

  const addOption = () => {
    const option = makeOption();
    onPatch({ options: [...question.options, option] });
    setExpandedOptionId(option.id);
  };

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel size="sm">Question</FieldLabel>
        <textarea
          rows={2}
          className={cn(inputClasses(), 'resize-y')}
          value={question.title}
          onChange={e => onPatch({ title: e.target.value })}
          placeholder="e.g. How is the mother positioning the baby?"
        />
      </div>

      <div>
        <FieldLabel size="sm">Help text (optional)</FieldLabel>
        <Input
          value={question.helpText}
          onChange={e => onPatch({ helpText: e.target.value })}
          placeholder="Extra guidance shown under the question"
        />
      </div>

      {/* Informative media for the question itself — shown above the answers in the runner. */}
      <MediaPicker
        label="Question images / GIFs (optional)"
        media={question.media ?? []}
        onChange={media => onPatch({ media })}
      />

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <FieldLabel size="sm">Answer type</FieldLabel>
          <Select value={question.questionType} onChange={e => changeType(e.target.value)}>
            {QUESTION_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Checkbox
          className="pb-2.5"
          label="Required"
          checked={question.required}
          onChange={e => onPatch({ required: e.target.checked })}
        />
      </div>

      {question.questionType === 'number' && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <FieldLabel size="sm" className="mb-0">
            Numerical settings
          </FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <FieldLabel size="sm">Decimal places</FieldLabel>
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
              <FieldLabel size="sm">Flag if below</FieldLabel>
              <Input
                type="number"
                value={numeric.flagMin ?? ''}
                onChange={e => setNumeric({ flagMin: numInput(e.target.value) })}
                placeholder="min"
              />
            </div>
            <div>
              <FieldLabel size="sm">Flag if above</FieldLabel>
              <Input
                type="number"
                value={numeric.flagMax ?? ''}
                onChange={e => setNumeric({ flagMax: numInput(e.target.value) })}
                placeholder="max"
              />
            </div>
          </div>
          <p className="text-[11px] leading-snug text-ink-faint">
            Values outside the range are still saved but flagged red to the learner and admin.
          </p>
        </div>
      )}

      {/* Per-question learner-view overrides (defaults live in the toolbar's
          "Learner view" panel; a row left on "Form default" inherits it). */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-baseline justify-between">
          <FieldLabel size="sm" className="mb-0">
            Learner view — this question
          </FieldLabel>
          <span className="text-[11px] text-ink-faint">
            {overrideCount > 0 ? `${overrideCount} override${overrideCount === 1 ? '' : 's'}` : 'form defaults'}
          </span>
        </div>
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-ink-muted">Help text</span>
            <div className="w-44 shrink-0">{boolOverrideSelect('helpText', 'Help text visibility')}</div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-ink-muted">Question images</span>
            <div className="w-44 shrink-0">{boolOverrideSelect('questionMedia', 'Question images visibility')}</div>
          </div>
          {hasOptions && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-ink-muted">Option images</span>
              <div className="w-44 shrink-0">{boolOverrideSelect('optionMedia', 'Option images visibility')}</div>
            </div>
          )}
          {hasOptions && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-ink-muted">Verdicts</span>
              <div className="w-44 shrink-0">
                <Select
                  aria-label="Verdict visibility"
                  className="py-1.5 text-[12px]"
                  value={override.verdictTiming ?? ''}
                  onChange={e =>
                    setOverride({
                      verdictTiming: e.target.value === '' ? null : (e.target.value as VerdictTiming),
                    })
                  }
                >
                  <option value="">Form default ({TIMING_LABELS[formDisplay.verdictTiming]})</option>
                  <option value="during">While answering</option>
                  <option value="after">After submitting</option>
                  <option value="never">Never</option>
                </Select>
              </div>
            </div>
          )}
          {hasOptions && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-ink-muted">Coaching actions</span>
              <div className="w-44 shrink-0">{boolOverrideSelect('actions', 'Coaching actions visibility')}</div>
            </div>
          )}
        </div>
      </div>

      {defaultNextSlot}

      {hasOptions && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <FieldLabel size="sm" className="mb-0">
              Answer options
            </FieldLabel>
            <span className="text-[11px] text-ink-faint">{question.options.length}</span>
          </div>
          <div className="space-y-2">
            {question.options.map((option, i) => (
              <OptionEditor
                key={option.id}
                option={option}
                index={i}
                count={question.options.length}
                verdictDefs={verdictDefs}
                allowBranch={branchable}
                branchTargets={branchTargets}
                connecting={connectingOptionId === option.id}
                expanded={expandedOptionId === option.id}
                onToggle={() => setExpandedOptionId(cur => (cur === option.id ? null : option.id))}
                onChange={o => updateOption(i, o)}
                onRemove={() => removeOption(i)}
                onMove={dir => moveOption(i, dir)}
                onStartConnect={onStartConnect ? () => onStartConnect(option.id) : undefined}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addOption}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong/70 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-primary hover:text-primary cursor-pointer"
          >
            <Plus className="size-4" /> Add option
          </button>
          {branchable && question.options.length > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-ink-faint">
              Answers with their own branch override the default next step.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionEditor;
