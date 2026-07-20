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
] as const;

export type FormKey = (typeof FORM_KEYS)[number];

export const FLOW_FORM_KEYS: FormKey[] = ['breastfeeding', 'complementary_feeding'];

export const isFlowFormKey = (key: string): key is 'breastfeeding' | 'complementary_feeding' =>
  key === 'breastfeeding' || key === 'complementary_feeding';

/**
 * Flat forms that accept learner responses (rendered by the flat runner).
 * Mirrors FLAT_RESPONSE_FORM_KEYS on the backend — the registration forms are
 * `flat` too, but they are coded pages and do not accept form responses.
 */
export const FLAT_RESPONSE_FORM_KEYS: FormKey[] = ['growth_monitoring'];

export const isFlatResponseFormKey = (key: string): key is 'growth_monitoring' =>
  key === 'growth_monitoring';

/** Any form key the learner can actually fill in (flow or flat). */
export const isResponseFormKey = (key: string): key is FormKey =>
  isFlowFormKey(key) || isFlatResponseFormKey(key);

/** CF assessments unlock at this child age (days). */
export const CF_MIN_AGE_DAYS = 150;

// ── Flow schema (canvas decision tree) ───────────────────────────────────────

export type QuestionType = 'single' | 'multi' | 'text' | 'date';
export type Verdict = 'green' | 'red' | null;
export type ActionType = 'none' | 'notify' | 'youtube' | 'video' | 'info';
export type MediaType = 'image' | 'gif';

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
  /** Default next node id; null = end of form. */
  next: string | null;
}

export interface FlowSectionNode {
  id: string;
  kind: 'section';
  title: string;
  position: { x: number; y: number };
  children: FlowSectionChild[];
  next: string | null;
}

export type FlowNode = FlowQuestionNode | FlowSectionNode;

export interface FlowSchema {
  startNodeId: string | null;
  nodes: Record<string, FlowNode>;
}

export const isSectionNode = (n: FlowNode): n is FlowSectionNode => n.kind === 'section';
export const isQuestionNode = (n: FlowNode): n is FlowQuestionNode => n.kind === 'question';

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
  // date fields
  noFuture?: boolean;
  /** Date must not be before the child's date of birth (child-scoped forms). */
  notBeforeDob?: boolean;
  /** Conditional display; absent/empty = always shown. */
  showIf?: FlatFieldCondition[];
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
  child_id: number;
  /** Included so pages deep-linked by response id can navigate back to the child. */
  mother_id: number;
  child_name: string;
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
