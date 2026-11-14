/**
 * Shared wording for the health worker's screens (launch review of 19 Oct
 * 2026): one short line per thing to do, colours always with a word.
 */
import type { TFunction } from 'i18next';
import { formRunUrl, type FormCode } from '../../api/today';
import { flowString } from '../../lib/careFlow';

/** A visit's forms in the order they are filled: weigh and measure first. */
export const FORM_ORDER: FormCode[] = ['gm', 'bf', 'cf', 'anc', 'protein'];

export const sortForms = (forms: FormCode[]): FormCode[] =>
  [...new Set(forms)].sort((a, b) => FORM_ORDER.indexOf(a) - FORM_ORDER.indexOf(b));

/** "Growth check, Breastfeeding" */
export const formNames = (forms: FormCode[], t: TFunction): string =>
  sortForms(forms).map(f => t(`field.form.${f}`)).join(', ');

/** Thu 23 Oct */
export const shortDay = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

/** 23 Oct — for dots and tight lines. */
export const dayMonth = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Sun */
export const weekdayOf = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
};

/** Today as YYYY-MM-DD in the phone's own time zone (not UTC). */
export const localIso = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const isTomorrow = (ymd: string): boolean => ymd === localIso(1);

/** "5 mo", "3 weeks", "12 days" — a baby's age in one short word. */
export const ageShort = (days: number | null | undefined, t: TFunction): string | null => {
  if (days == null || days < 0) return null;
  if (days < 14) return t('field.age.days', { count: days });
  if (days < 98) return t('field.age.weeks', { count: Math.round(days / 7) });
  return t('field.ageMonths', { count: Math.floor(days / 30.4375) });
};

/** The person a visit is about: the baby by name, else the mother. */
export const whoLine = (
  g: { mother_name: string; child_id: number | null; child_name: string | null },
  t: TFunction,
): { name: string; sub: string } =>
  g.child_id != null
    ? { name: g.child_name || t('field.baby'), sub: t('field.motherIs', { mother: g.mother_name }) }
    : { name: g.mother_name, sub: t('field.motherWord') };

/** The first form of a visit, carrying the rest so they follow one after another.
 *  A pregnancy visit from 35 weeks (November 2026 protocol) first asks "Has
 *  the delivery happened?" — `askDelivery` opens that question instead. */
export const visitUrl = (motherId: number, childId: number | null, forms: FormCode[], askDelivery = false) => {
  if (askDelivery && childId == null) return `/mothers/${motherId}/delivery?forms=${sortForms(forms).join('.')}`;
  const [first, ...rest] = sortForms(forms);
  return formRunUrl(first, motherId, childId, flowString('visit', rest));
};
