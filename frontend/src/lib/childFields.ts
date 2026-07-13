// Fixed value sets for the Child Registration (CR) form, taken verbatim from the
// EP HST "CR" sheet. CR has no cascading/data-driven lists, so every option set is
// a fixed enum and lives here (mirrors lib/motherFields.ts for MR).

export const BABIES_BORN = ['Single', 'Twins'];

export const SEXES = ['Female', 'Male'];

export const DELIVERY_METHODS = [
  'Normal vaginal delivery',
  'Caesarean section',
  'Assisted vaginal delivery',
];

export const DELIVERY_PLACES = [
  'District Hospital (DH)',
  'Rural Hospital (RH)',
  'Sub-District Hospital (SDH)',
  'Community Health Centre (CHC)',
  'Primary Health Centre (PHC)',
  'Sub-centre (SC)',
  'Private Hospital/Nursing Home',
  'Home',
  'Other',
];

// Pre-existing / birth conditions — a multi-select checklist (the sheet flags this
// as the intended future shape; we build it that way now). "Others" reveals a text field.
export const BIRTH_CONDITIONS = [
  'None',
  'Congenital anomaly/Birth defect',
  'Birth asphyxia (difficulty breathing at birth)',
  'Neonatal jaundice',
  'Respiratory distress/Breathing difficulty',
  'Neonatal infection/Sepsis',
  'Hypoglycaemia (low blood sugar)',
  'Others',
];

/** Child age from DOB as { days, months }, or null if no/invalid DOB. */
export function childAge(dob: string): { days: number; months: number } | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 0) return null;
  return { days, months: Math.floor(days / 30) };
}
