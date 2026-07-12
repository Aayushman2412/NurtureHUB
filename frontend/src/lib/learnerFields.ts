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
export const GENDERS = ['Female', 'Male', 'Other'];
export const MARITAL = ['Never married', 'Married', 'Widowed', 'Divorced', 'Separated'];
export const INTERNET = ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'];
export const TRAINING_RECENCY = [
  'Within the last 3 months', '4–6 months ago', '7–12 months ago',
  '1–2 years ago', 'More than 2 years ago', 'Never attended', "Don't know",
];

export const TRAININGS: { key: string; label: string }[] = [
  { key: 'nutrition_training', label: 'When did you last attend any nutrition-related training?' },
  { key: 'pregnancy_nutrition_training', label: 'When did you last attend a pregnancy nutrition-related training?' },
  { key: 'breastfeeding_training', label: 'When did you last attend a breastfeeding-related training?' },
  { key: 'complementary_feeding_training', label: 'When did you last attend a complementary feeding-related training?' },
  { key: 'growth_monitoring_training', label: 'When did you last attend a growth monitoring & growth chart interpretation training?' },
];

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
