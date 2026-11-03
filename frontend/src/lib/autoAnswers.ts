/**
 * Answers a form can take from what the registration already says (review of
 * 30 Oct 2026). Sir: short stature "must be selected only when a mother's
 * height is really less than 145 … make sure these three are auto added …
 * instead of allowing them to select and add unnecessary confusions"; and on
 * the protein form, "though this is a pregnant woman it took up the option of
 * lactating — it should be auto selected based on the status".
 */
import type { FlatFieldOption } from './flowTypes';

export interface AutoRisk {
  value: string;
  label: string;
  /** Which registration answer decides it. */
  basis: 'height' | 'age';
  /** null = the registration does not say (no height, no age recorded). */
  applies: boolean | null;
}

/** High-risk options matched by label, so every version of the form is covered. */
const RULES: { re: RegExp; basis: AutoRisk['basis']; test: (heightCm: number | null, ageYears: number | null) => boolean | null }[] = [
  { re: /short stature/i, basis: 'height', test: h => (h == null ? null : h < 145) },
  { re: /less than 18/i, basis: 'age', test: (_h, a) => (a == null ? null : a < 18) },
  { re: /more than 35/i, basis: 'age', test: (_h, a) => (a == null ? null : a > 35) },
];

/** Whole years from one ISO date to another. */
const yearsBetween = (fromIso: string, toIso: string): number | null => {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromIso);
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(toIso);
  if (!a || !b) return null;
  let years = Number(b[1]) - Number(a[1]);
  if (Number(b[2]) < Number(a[2]) || (b[2] === a[2] && Number(b[3]) < Number(a[3]))) years -= 1;
  return years;
};

/** The mother's age on a date: from her date of birth, else the age given at registration. */
export const motherAgeOn = (dob: string | null | undefined, ageAtRegistration: number | null | undefined, onIso: string): number | null =>
  (dob ? yearsBetween(dob, onIso) : null) ?? (ageAtRegistration ?? null);

export const autoRisks = (options: FlatFieldOption[], heightCm: number | null, ageYears: number | null): AutoRisk[] =>
  RULES.flatMap(rule => {
    const option = options.find(o => rule.re.test(o.label));
    return option ? [{ value: option.value, label: option.label, basis: rule.basis, applies: rule.test(heightCm, ageYears) }] : [];
  });

/**
 * What is stored: the conditions the registration identifies, then what the
 * learner ticked among the rest. "None" cannot stand beside an identified
 * condition — it then means "none of the others", which the list already says.
 */
export const withAutoRisks = (ticked: string[], autos: AutoRisk[], exclusiveValues: Set<string>): string[] => {
  const autoValues = new Set(autos.map(a => a.value));
  const identified = autos.filter(a => a.applies).map(a => a.value);
  const rest = ticked.filter(v => !autoValues.has(v) && !(identified.length > 0 && exclusiveValues.has(v)));
  return [...identified, ...rest];
};

/** Protein form "Mother's Status": pregnant until her baby is registered or the
 *  adoption says she has delivered. */
export const proteinStatusOption = (pregnant: boolean): string =>
  pregnant ? 'pca_status_pregnant' : 'pca_status_lactating';
