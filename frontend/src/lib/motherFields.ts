// Shared building blocks for the Mother Registration (MR) form — fixed value sets,
// the trust/willingness matrix sources, and date helpers. Cascading option lists
// (geography, HWC/PHC, education field→degree) come from the backend via
// useMotherMetadata; only the truly-fixed enums live here.

export interface Option { id: number; name: string; }

/** Sentinel HWC id for "Other (specify)" — stored as hwc_other free text, hwc_id null. */
export const HWC_OTHER = -1;

// ── Fixed value sets (from the EP HST "MR" sheet, delimiters canonicalised) ──
export const OCCUPATIONS = [
  'Homemaker', 'Agriculture', 'Skilled Manual Worker', 'Semi-skilled Worker',
  'Unskilled Worker', 'Service Provider', 'Semi-professional', 'Professional',
  'Entrepreneur/Small Business', 'Other',
];

export const RATION_CARDS = [
  'AAY', 'Eligible for AAY but not applied', 'BPL', 'Eligible for BPL but not applied',
  'APL', 'No ration card', 'Others',
];

export const SOCIAL_CATEGORIES = ['ST', 'SC', 'OBC', 'General', 'Do not know', 'Prefer not to say'];

export const VIDEO_FREQUENCY = [
  'Daily', 'Alternate day / 2–3 times per week', 'Once a week', '2–3 times per month',
  'About once a month', 'Less than once a month', 'Never',
];

// The four standalone Likert questions (each a 5-point scale with its own anchors).
export const LIKERT: { key: string; label: string; options: string[] }[] = [
  {
    key: 'implement_video',
    label: 'How often do you follow the advice you receive from health-related videos?',
    options: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
  },
  {
    key: 'confidence_video',
    label: 'How confident are you in trying a new health practice after watching a reliable educational video?',
    options: ['Not at all confident', 'Slightly confident', 'Moderately confident', 'Very confident', 'Extremely confident'],
  },
  {
    key: 'willingness_hcw',
    label: 'If a healthcare worker teaches you a new health practice, how willing are you to try it?',
    options: ['I would not try it', 'I would hesitate to try it', 'I might try it', 'I would likely try it', 'I would definitely try it'],
  },
  {
    key: 'information_seeking',
    label: 'When you had a question about pregnancy, breastfeeding or feeding your baby, how often did you actively look for information?',
    options: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
  },
];

// The trust/willingness matrix rows (source key + display label).
export const MATRIX_SOURCES: { key: string; label: string }[] = [
  { key: 'doctor', label: 'Doctor' },
  { key: 'staff_nurse', label: 'Staff Nurse' },
  { key: 'anm', label: 'ANM' },
  { key: 'asha', label: 'ASHA' },
  { key: 'anganwadi_worker', label: 'Anganwadi Worker' },
  { key: 'nutritionist', label: 'Nutritionist/Dietitian' },
  { key: 'family', label: 'Family members' },
  { key: 'friends', label: 'Friends/Neighbours' },
  { key: 'youtube', label: 'YouTube/Social media' },
];

// ── i18n option builders — English value + translated label ──
// `t` must be bound to the 'mother' namespace (useTranslation('mother')). The
// translated labels are keyed by the canonical English value under options.*;
// the value itself stays English (it is what the API stores). None of the enum
// values contain a '.', so they are safe as i18next nested-key segments.
type TFn = (key: string) => string;
const toOptions = (list: string[], t: TFn, group: string) =>
  list.map(v => ({ value: v, label: t(`options.${group}.${v}`) }));

export const occupationOptions = (t: TFn) => toOptions(OCCUPATIONS, t, 'occupation');
export const rationCardOptions = (t: TFn) => toOptions(RATION_CARDS, t, 'rationCard');
export const socialCategoryOptions = (t: TFn) => toOptions(SOCIAL_CATEGORIES, t, 'socialCategory');
export const videoFrequencyOptions = (t: TFn) => toOptions(VIDEO_FREQUENCY, t, 'videoFrequency');

/** The four Likert questions with translated question label + translated 5-point options. */
export const likertQuestions = (t: TFn) =>
  LIKERT.map(q => ({
    key: q.key,
    label: t(`options.likertQuestion.${q.key}`),
    options: q.options.map(o => ({ value: o, label: t(`options.likert.${q.key}.${o}`) })),
  }));

/** Trust/willingness matrix rows with translated source labels (keys unchanged). */
export const sourceRows = (t: TFn) =>
  MATRIX_SOURCES.map(s => ({ key: s.key, label: t(`options.source.${s.key}`) }));

// ── Adoption-window rules ──

/** A mother must be at least 12 weeks pregnant on the day she is adopted. */
export const MIN_GESTATION_DAYS = 84;
/** …and no more than 180 days (≈25½ weeks) past her LMP. */
export const MAX_GESTATION_DAYS = 180;
/** An adoption may be backdated by at most a fortnight. */
export const MAX_ADOPTION_AGE_DAYS = 14;

// ── Date helpers ──

/** Today as a LOCAL ISO date. `toISOString()` would give the UTC date, which is
 *  still yesterday for IST users between midnight and 05:30. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO date exactly N days before today (e.g. the earliest backdatable adoption). */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO date exactly N years before today (e.g. the max DOB for a minimum age). */
export function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Whole days from ISO date `b` to ISO date `a` (a − b); NaN if either is invalid. */
export function isoDaysBetween(a: string, b: string): number {
  return Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

/** Expected date of delivery = LMP + 280 days, as a yyyy-mm-dd string ('' if no LMP). */
export function eddFromLmp(lmp: string): string {
  if (!lmp) return '';
  const d = new Date(lmp);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 280);
  return d.toISOString().slice(0, 10);
}

/**
 * Days of gestation elapsed at `asOf` (default today), or null when the LMP is
 * missing/invalid/in the future. Both ends are compared as ISO dates so the
 * count never drifts by a day with the clock or the timezone.
 */
export function gestationDays(lmp: string, asOf?: string): number | null {
  if (!lmp) return null;
  const days = isoDaysBetween(asOf || todayIso(), lmp);
  return Number.isNaN(days) || days < 0 ? null : days;
}

/**
 * Gestational age as { weeks, days } — the obstetric convention ("25 weeks
 * 6 days"), not weeks-and-months. `asOf` defaults to today; the registration
 * form passes the adoption date so the number shown is the one the 12-week
 * eligibility rule is judged on.
 */
export function gestationalAge(lmp: string, asOf?: string): { weeks: number; days: number } | null {
  const total = gestationDays(lmp, asOf);
  if (total == null) return null;
  return { weeks: Math.floor(total / 7), days: total % 7 };
}
