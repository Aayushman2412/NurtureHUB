/**
 * Shared types for the dynamic form system.
 *
 * Two builder types exist:
 *  - 'flat' — a simple ordered field list (learner/mother/child/growth/antenatal),
 *    edited with the classic form-builder UI.
 *  - 'flow' — a decision-tree of question nodes designed on the admin canvas
 *    (breastfeeding & complementary feeding) and rendered by the learner runner.
 *
 * These types mirror the backend JSON contract exactly (see form_definitions.schema_json
 * and form_responses on the backend). Do not redefine them elsewhere — import from here.
 */

// ── Form keys ────────────────────────────────────────────────────────────────

export const FORM_KEYS = [
  'learner_registration',
  'mother_registration',
  'child_registration',
  'breastfeeding',
  'complementary_feeding',
  'growth_monitoring',
  'antenatal',
  'mother_protein_intake',
] as const;

export type FormKey = (typeof FORM_KEYS)[number];

export const FLOW_FORM_KEYS: FormKey[] = [
  'breastfeeding',
  'complementary_feeding',
  'mother_protein_intake',
];

export const isFlowFormKey = (
  key: string,
): key is 'breastfeeding' | 'complementary_feeding' | 'mother_protein_intake' =>
  key === 'breastfeeding' || key === 'complementary_feeding' || key === 'mother_protein_intake';

/** Forms that attach to a MOTHER (per-visit) rather than a child. */
export const MOTHER_FORM_KEYS: FormKey[] = ['mother_protein_intake', 'antenatal'];

export const isMotherFormKey = (key: string): key is 'mother_protein_intake' | 'antenatal' =>
  key === 'mother_protein_intake' || key === 'antenatal';

/**
 * Flat forms that accept learner responses (rendered by the flat runner).
 * Mirrors FLAT_RESPONSE_FORM_KEYS on the backend — the registration forms are
 * `flat` too, but they are coded pages and do not accept form responses.
 */
export const FLAT_RESPONSE_FORM_KEYS: FormKey[] = ['growth_monitoring', 'antenatal'];

export const isFlatResponseFormKey = (key: string): key is 'growth_monitoring' | 'antenatal' =>
  key === 'growth_monitoring' || key === 'antenatal';

/** Any form key the learner can actually fill in (flow or flat). */
export const isResponseFormKey = (key: string): key is FormKey =>
  isFlowFormKey(key) || isFlatResponseFormKey(key);

/** CF assessments unlock at this child age (days). */
export const CF_MIN_AGE_DAYS = 150;

// ── Flow schema (canvas decision tree) ───────────────────────────────────────

export type QuestionType = 'single' | 'multi' | 'text' | 'date' | 'number';

/**
 * An option's verdict, stored as a VerdictDef **id** (`null` = no verdict).
 *
 * Historically this was the closed union `'green' | 'red' | null`; those two
 * ids are still the built-in defaults, so old definitions and every stored
 * response keep working unchanged.
 */
export type Verdict = string | null;

/**
 * How a verdict counts toward the score. Custom verdicts must declare this —
 * otherwise the pass/fail summary would be meaningless. Scoring is what keeps
 * `summary_json` a stable `{green, red, neutral}` shape no matter how many
 * verdicts a form defines, so history/trend/plan rendering never changes.
 */
export type VerdictScoring = 'positive' | 'negative' | 'neutral';

export interface VerdictDef {
  id: string;
  label: string;
  /** Any CSS color; used for the chip, the node card and the canvas edge. */
  color: string;
  scoring: VerdictScoring;
}

/** Built-ins. Their labels come from i18n, so they stay translated. */
export const BUILTIN_VERDICT_IDS = ['green', 'red'] as const;

export const DEFAULT_VERDICTS: VerdictDef[] = [
  { id: 'green', label: 'As per LAP', color: '#10b981', scoring: 'positive' },
  { id: 'red', label: 'Needs tutorial', color: '#f43f5e', scoring: 'negative' },
];

export const isBuiltinVerdict = (id: string): boolean =>
  (BUILTIN_VERDICT_IDS as readonly string[]).includes(id);

/** A form's verdict list, falling back to the built-ins when absent. */
export const resolveVerdicts = (defs: VerdictDef[] | undefined): VerdictDef[] =>
  defs && defs.length > 0 ? defs : DEFAULT_VERDICTS;

export const findVerdict = (defs: VerdictDef[], id: Verdict): VerdictDef | null =>
  id ? (defs.find(d => d.id === id) ?? null) : null;

/** When the learner may see verdicts. */
export type VerdictTiming = 'during' | 'after' | 'never';
export type ActionType = 'none' | 'notify' | 'youtube' | 'video' | 'info';
export type MediaType = 'image' | 'gif';

/**
 * A soft numeric "expected range". Unlike a hard min/max (which rejects the
 * input), a value outside [flagMin, flagMax] is still accepted and stored but
 * flagged red to the learner and admin after submission. Either bound may be
 * null (open-ended on that side). Used by `number` questions/fields and numeric
 * matrix columns.
 */
export interface NumericRange {
  /** Max decimal places allowed (hard). Defaults to 1 for the numerical type. */
  decimals?: number | null;
  /** Flag (not block) when the value is below this. */
  flagMin?: number | null;
  /** Flag (not block) when the value is above this. */
  flagMax?: number | null;
}

export interface FlowMedia {
  type: MediaType;
  url: string;
}

export interface FlowAction {
  type: ActionType;
  /** Notification / info text; doubles as a caption for video actions. */
  message: string;
  /** YouTube URL (type 'youtube') or uploaded/absolute video URL (type 'video'). */
  url: string;
  /** YouTube clip window, in seconds. */
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface FlowOption {
  id: string;
  label: string;
  media: FlowMedia[];
  /** 'green' = as per LAP, 'red' = not per LAP, null = neutral. */
  verdict: Verdict;
  action: FlowAction;
  /** Branch override (single-select questions only). null → follow the node's default `next`. */
  next: string | null;
}

/** A question inside a common-section block: same shape, but no position/branching. */
/**
 * Per-QUESTION overrides of the form's learner-view defaults. Every key is
 * optional — an absent/null key inherits the form-level setting, so a question
 * with no override behaves exactly as the form default dictates.
 */
export interface QuestionDisplayOverride {
  helpText?: boolean | null;
  questionMedia?: boolean | null;
  optionMedia?: boolean | null;
  verdictTiming?: VerdictTiming | null;
  actions?: boolean | null;
}

/** Form defaults + a question's overrides → the effective settings for it. */
export function resolveQuestionDisplay(
  form: FlowDisplaySettings,
  override: QuestionDisplayOverride | null | undefined,
): FlowDisplaySettings {
  if (!override) return form;
  return {
    helpText: override.helpText ?? form.helpText,
    questionMedia: override.questionMedia ?? form.questionMedia,
    optionMedia: override.optionMedia ?? form.optionMedia,
    verdictTiming: override.verdictTiming ?? form.verdictTiming,
    actions: override.actions ?? form.actions,
  };
}

/**
 * Answer-dependent visibility for a TOP-LEVEL flow node: the node is shown
 * only when the referenced single/multi question's answer includes at least
 * one of `anyOf` (option ids). While hidden, the runner walks straight through
 * the node's `next` without asking it — so gated nodes stay in the default
 * chain and need no branch gymnastics. Absent = always visible.
 */
export interface VisibleIf {
  nodeId: string;
  anyOf: string[];
}

/** Does an answers snapshot satisfy a visibility rule? (absent rule = yes) */
export const visibleIfSatisfied = (
  rule: VisibleIf | null | undefined,
  selectedOptionIds: string[] | undefined,
): boolean => {
  if (!rule || rule.anyOf.length === 0) return true;
  if (!selectedOptionIds || selectedOptionIds.length === 0) return false;
  return rule.anyOf.some(id => selectedOptionIds.includes(id));
};

export interface FlowSectionChild {
  id: string;
  kind: 'question';
  questionType: QuestionType;
  title: string;
  helpText: string;
  required: boolean;
  /** Informative images/GIFs shown with the question itself (not tied to any option).
   *  Optional: definitions saved before this field existed omit it. */
  media?: FlowMedia[];
  options: FlowOption[];
  /** Numeric constraints (questionType 'number' only). */
  numeric?: NumericRange | null;
  /** Per-question learner-view overrides; absent = inherit the form defaults. */
  display?: QuestionDisplayOverride | null;
}

export interface FlowQuestionNode {
  id: string;
  kind: 'question';
  questionType: QuestionType;
  title: string;
  helpText: string;
  required: boolean;
  /** Informative images/GIFs shown with the question itself (not tied to any option).
   *  Optional: definitions saved before this field existed omit it. */
  media?: FlowMedia[];
  position: { x: number; y: number };
  options: FlowOption[];
  /** Numeric constraints (questionType 'number' only). */
  numeric?: NumericRange | null;
  /** Default next node id; null = end of form. */
  next: string | null;
  /** Per-question learner-view overrides; absent = inherit the form defaults. */
  display?: QuestionDisplayOverride | null;
  /** Answer-dependent visibility; absent = always shown. */
  visibleIf?: VisibleIf | null;
}

export interface FlowSectionNode {
  id: string;
  kind: 'section';
  title: string;
  position: { x: number; y: number };
  children: FlowSectionChild[];
  next: string | null;
  /** Answer-dependent visibility; absent = always shown. */
  visibleIf?: VisibleIf | null;
}

// ── Info block ────────────────────────────────────────────────────────────────

/**
 * A non-answerable informational block shown between questions: a heading +
 * rich body text, optional images/GIFs, and an optional call-to-action
 * (watch a YouTube clip from a timestamp, open an uploaded video, or a link/
 * "go do this" prompt). Collects no answer and never scores.
 */
export interface FlowInfoNode {
  id: string;
  kind: 'info';
  title: string;
  /** Body/explanatory text (multi-line). */
  body: string;
  /** Illustrative images/GIFs. */
  media: FlowMedia[];
  /** Optional call-to-action (youtube clip / uploaded video / link prompt). */
  action: FlowAction;
  position: { x: number; y: number };
  next: string | null;
  /** Answer-dependent visibility; absent = always shown. */
  visibleIf?: VisibleIf | null;
}

// ── Multi-dropdown matrix ─────────────────────────────────────────────────────

/** The input kind of one matrix column. */
export type MatrixColumnType = 'number' | 'text' | 'date' | 'datetime' | 'dropdown';

export interface MatrixColumn {
  id: string;
  label: string;
  type: MatrixColumnType;
  required: boolean;
  /** For 'dropdown': the selectable values (e.g. 0, 0.5, 1, …). */
  options: FlatFieldOption[] | null;
  /** For 'number': decimal + soft flag range. */
  numeric?: NumericRange | null;
  /** Admin switch: collect nothing and show nothing for this column. */
  learnerHidden?: boolean | null;
  /** Frequency-style column: a 0 value auto-fills the row's other input
   *  columns with 0 and locks them (per the PCA sheet's skip rule). */
  zeroesRow?: boolean | null;
}

export interface MatrixRow {
  id: string;
  label: string;
  helpText?: string;
  /** Protein grams per standard serving — feeds the computed intake totals. */
  proteinPerServing?: number | null;
  /** Counts toward the high-quality (animal/dairy) protein totals. */
  highQuality?: boolean | null;
}

/**
 * A grid question: each row is a subject (e.g. a food) and each column a
 * dropdown/input (e.g. "portions in last 24h", "days per week"). Answers are a
 * per-cell map. Modeled on the Cuedwell protein-intake matrix.
 */
export interface FlowMatrixNode {
  id: string;
  kind: 'matrix';
  title: string;
  helpText: string;
  /** When true, every required column must be answered for every row. */
  required: boolean;
  rows: MatrixRow[];
  columns: MatrixColumn[];
  position: { x: number; y: number };
  next: string | null;
  /** Answer-dependent visibility; absent = always shown. */
  visibleIf?: VisibleIf | null;
}

export type FlowNode = FlowQuestionNode | FlowSectionNode | FlowInfoNode | FlowMatrixNode;

/**
 * Admin-controlled switches for what the LEARNER sees while running the form.
 * Nothing here changes what is collected or stored — only what is displayed.
 *
 * All default to `true`: a definition saved before these existed (or with the
 * key absent) shows everything, exactly as before.
 */
export interface FlowDisplaySettings {
  /** Guidance text under each question. */
  helpText: boolean;
  /** Informative images/GIFs attached to the question. */
  questionMedia: boolean;
  /** Images on answer options (they fall back to a letter tile). */
  optionMedia: boolean;
  /**
   * When the verdict chip is revealed.
   *  - 'during' — as soon as an answer is picked (training: instant feedback,
   *    but the worker can then change the answer, so it biases the data)
   *  - 'after'  — only on the assessment plan, once the form is submitted
   *  - 'never'  — not shown to the learner at all
   */
  verdictTiming: VerdictTiming;
  /** Coaching actions: the plan's action cards + the per-action notifications. */
  actions: boolean;
}

export const DEFAULT_DISPLAY: FlowDisplaySettings = {
  helpText: true,
  questionMedia: true,
  optionMedia: true,
  // Default to feedback-after-submit: showing it during lets a worker change
  // their answer once they see the verdict, which silently corrupts the data.
  verdictTiming: 'after',
  actions: true,
};

/** Fill in any missing/legacy keys so callers can read the settings directly. */
export const resolveDisplay = (
  d: (Partial<FlowDisplaySettings> & { verdicts?: boolean }) | undefined,
): FlowDisplaySettings => {
  const raw = d ?? {};
  // Legacy: `verdicts` was a boolean meaning "show the chip while answering".
  const legacyTiming: VerdictTiming | undefined =
    raw.verdictTiming === undefined && typeof raw.verdicts === 'boolean'
      ? raw.verdicts
        ? 'during'
        : 'after'
      : undefined;
  return {
    ...DEFAULT_DISPLAY,
    ...raw,
    verdictTiming: raw.verdictTiming ?? legacyTiming ?? DEFAULT_DISPLAY.verdictTiming,
  };
};

export interface FlowSchema {
  startNodeId: string | null;
  nodes: Record<string, FlowNode>;
  /** Learner-visibility switches; absent = defaults. */
  display?: Partial<FlowDisplaySettings>;
  /** This form's verdict vocabulary; absent/empty = the built-in green + red. */
  verdicts?: VerdictDef[];
}

export const isSectionNode = (n: FlowNode): n is FlowSectionNode => n.kind === 'section';
export const isQuestionNode = (n: FlowNode): n is FlowQuestionNode => n.kind === 'question';
export const isInfoNode = (n: FlowNode): n is FlowInfoNode => n.kind === 'info';
export const isMatrixNode = (n: FlowNode): n is FlowMatrixNode => n.kind === 'matrix';

/** A matrix answer: { [rowId]: { [colId]: value } }, JSON-encoded in the wire
 * `value` field so the {nodeId, optionIds, value} answer shape is unchanged. */
export type MatrixAnswer = Record<string, Record<string, string>>;

export const parseMatrixAnswer = (raw: string | null | undefined): MatrixAnswer => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as MatrixAnswer) : {};
  } catch {
    return {};
  }
};

// ── Flat schema (classic field list) ─────────────────────────────────────────

export interface FlatFieldOption {
  label: string;
  value: string;
}

export type FlatFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'radio'
  | 'textarea'
  | 'checkbox' // multi-select
  | 'image';   // photo upload (stores an /uploads/... URL)

/**
 * A display condition. All of a field's conditions must hold (AND) for it to
 * be shown — and only visible fields are validated/submitted.
 */
export interface FlatFieldCondition {
  kind: 'field' | 'ageLtDays' | 'ageGteDays';
  /** kind 'field': the controlling field's id. */
  fieldId?: string;
  /** kind 'field': show when the controlling field's value (any of its selected
   *  values, for checkboxes) is one of these option values. */
  anyOf?: string[];
  /** kind 'ageLtDays' / 'ageGteDays': child age threshold in days. */
  days?: number;
}

export interface FlatField {
  id: string;
  label: string;
  type: FlatFieldType;
  placeholder: string;
  required: boolean;
  options: FlatFieldOption[] | null;
  /** Extra guidance shown under the label. */
  helpText?: string;
  // number fields
  min?: number | null;
  max?: number | null;
  /** Allowed decimal places (0 = integers only; null/undefined = any). */
  decimals?: number | null;
  /** Soft "expected range": a value below flagMin or above flagMax is still
   *  accepted and stored, but flagged red to the learner + admin after submit
   *  (distinct from the hard min/max which reject). */
  flagMin?: number | null;
  flagMax?: number | null;
  // date fields
  noFuture?: boolean;
  /** Date must not be before the child's date of birth (child-scoped forms). */
  notBeforeDob?: boolean;
  /** Conditional display; absent/empty = always shown. */
  showIf?: FlatFieldCondition[];
  /** Read-only derived field, computed by the runner and stored as text:
   *  gestational_age — from the mother's LMP at the assessment date;
   *  weight_gain — current weight minus the previous visit's weight. */
  computed?: 'gestational_age' | 'weight_gain' | null;
}

export interface FlatSchema {
  fields: FlatField[];
}

// ── Definitions & responses (API payloads) ───────────────────────────────────

export interface FormDefinitionSummary {
  form_key: FormKey;
  title: string;
  builder_type: 'flow' | 'flat';
  version: number;
  updated_at: string | null;
  node_count: number;
}

export interface FormDefinition {
  id: number;
  form_key: FormKey;
  title: string;
  description: string | null;
  builder_type: 'flow' | 'flat';
  version: number;
  schema_json: FlowSchema | FlatSchema;
  updated_at: string | null;
  updated_by: string | null;
}

/** One answer as the learner runner submits it (server re-derives labels/verdicts). */
export interface AnswerIn {
  nodeId: string;
  /** Set when the question lives inside a common section. */
  sectionId?: string | null;
  optionIds: string[];
  value?: string | null;
}

export interface SelectedOptionSnapshot {
  optionId: string;
  label: string;
  verdict: Verdict;
  action: FlowAction;
}

export interface AnswerSnapshot {
  nodeId: string;
  sectionId: string | null;
  question: string;
  questionType: QuestionType;
  value: string | null;
  selected: SelectedOptionSnapshot[];
}

export interface ResponseSummary {
  green: number;
  red: number;
  neutral: number;
  answered: number;
  total: number;
  /** Computed protein-intake totals (grams) — present only when the form's
   *  matrices carry proteinPerServing values (the protein form). */
  protein?: {
    total24: number;
    hq24: number;
    dailyAvg: number;
    hqDailyAvg: number;
  };
}

export interface TriggeredAction {
  nodeId: string;
  question: string;
  optionId: string;
  optionLabel: string;
  verdict: Verdict;
  action: FlowAction;
}

export interface FormResponseListItem {
  id: number;
  assessment_date: string;
  status: 'draft' | 'submitted';
  summary_json: ResponseSummary;
  definition_version: number;
  created_at: string;
  updated_at: string | null;
}

export interface FormResponseDetail extends FormResponseListItem {
  form_key: FormKey;
  /** Child-level responses set child_id; mother-level set mother_id. */
  child_id: number | null;
  /** Included so pages deep-linked by response id can navigate back. */
  mother_id: number | null;
  child_name: string | null;
  mother_name: string | null;
  answers_json: AnswerSnapshot[];
  actions_json: TriggeredAction[];
}

// ── Factories (canvas builder helpers) ───────────────────────────────────────

export const emptyAction = (): FlowAction => ({
  type: 'none',
  message: '',
  url: '',
  startSeconds: null,
  endSeconds: null,
});

export const emptyFlowSchema = (): FlowSchema => ({ startNodeId: null, nodes: {} });
