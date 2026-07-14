// Shared building blocks for the Learner Registration (LR) fields — used by both
// the registration wizard (RegistrationPage) and the profile editor (ProfilePage)
// so option lists, fixed value sets, and helpers live in one place.

// ── Option list shapes (from /api/metadata/*) ──
export interface StateOption { id: number; name: string; }
export interface DistrictOption { id: number; state_id: number; name: string; }
export interface BlockOption { id: number; district_id: number; name: string; }
export interface VillageOption { id: number; block_id: number; name: string; }
export interface FacilityOption { id: number; block_id: number; name: string; facility_type: string; }
export interface QualificationOption { id: number; qualification_name: string; has_semi_open_input: boolean; }
export interface DepartmentOption { id: number; code: string; name: string; }
export interface DesignationOption { id: number; department_id: number; name: string; is_other: boolean; }
export interface FacilityTypeOption { id: number; name: string; is_other: boolean; }

// ── Fixed value sets (stable enums straight from the EP HST "LR" sheet) ──
// NOTE: these string values are the canonical, backend-facing enum values — they
// are submitted to the API as-is and must stay in English. For i18n, translate only
// the *display label* (see the *Options() helpers below), never the value.
export const GENDERS = ['Female', 'Male', 'Other'];
export const MARITAL = ['Never married', 'Married', 'Widowed', 'Divorced', 'Separated'];
export const INTERNET = ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'];
export const TRAINING_RECENCY = [
  'Within the last 3 months', '4–6 months ago', '7–12 months ago',
  '1–2 years ago', 'More than 2 years ago', 'Never attended', "Don't know",
];

// Only the training *keys* matter for submission; the questions themselves are
// translated via the 'learner:trainings.<key>' locale entries.
export const TRAINING_KEYS = [
  'nutrition_training',
  'pregnancy_nutrition_training',
  'breastfeeding_training',
  'complementary_feeding_training',
  'growth_monitoring_training',
] as const;

// Backward-compat: some callers still read the English label directly.
export const TRAININGS: { key: string; label: string }[] = [
  { key: 'nutrition_training', label: 'When did you last attend any nutrition-related training?' },
  { key: 'pregnancy_nutrition_training', label: 'When did you last attend a pregnancy nutrition-related training?' },
  { key: 'breastfeeding_training', label: 'When did you last attend a breastfeeding-related training?' },
  { key: 'complementary_feeding_training', label: 'When did you last attend a complementary feeding-related training?' },
  { key: 'growth_monitoring_training', label: 'When did you last attend a growth monitoring & growth chart interpretation training?' },
];

// ── i18n option builders — English value + translated label ──
// `t` must be bound to the 'learner' namespace (useTranslation('learner')).
type TFn = (key: string) => string;

// Maps each canonical English enum value → its 'learner:options.*' locale key slug.
const GENDER_KEY: Record<string, string> = { Female: 'female', Male: 'male', Other: 'other' };
const MARITAL_KEY: Record<string, string> = {
  'Never married': 'neverMarried', Married: 'married', Widowed: 'widowed', Divorced: 'divorced', Separated: 'separated',
};
const INTERNET_KEY: Record<string, string> = {
  Always: 'always', Often: 'often', Sometimes: 'sometimes', Rarely: 'rarely', Never: 'never',
};
const RECENCY_KEY: Record<string, string> = {
  'Within the last 3 months': 'within3m', '4–6 months ago': 'm4to6', '7–12 months ago': 'm7to12',
  '1–2 years ago': 'y1to2', 'More than 2 years ago': 'moreThan2y', 'Never attended': 'neverAttended',
  "Don't know": 'dontKnow',
};

export const genderOptions = (t: TFn) => GENDERS.map(v => ({ value: v, label: t(`options.gender.${GENDER_KEY[v]}`) }));
export const maritalOptions = (t: TFn) => MARITAL.map(v => ({ value: v, label: t(`options.marital.${MARITAL_KEY[v]}`) }));
export const internetOptions = (t: TFn) => INTERNET.map(v => ({ value: v, label: t(`options.internet.${INTERNET_KEY[v]}`) }));
export const recencyOptions = (t: TFn) => TRAINING_RECENCY.map(v => ({ value: v, label: t(`options.recency.${RECENCY_KEY[v]}`) }));

/** Age in whole years from a yyyy-mm-dd date string, or '' if invalid. */
export function ageFromDob(dob: string): number | '' {
  if (!dob) return '';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 120 ? age : '';
}
