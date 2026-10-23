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

/** The person a visit is about: the baby by name, else the mother. */
export const whoLine = (
  g: { mother_name: string; child_id: number | null; child_name: string | null },
  t: TFunction,
): { name: string; sub: string } =>
  g.child_id != null
    ? { name: g.child_name || t('field.baby'), sub: t('field.motherIs', { mother: g.mother_name }) }
    : { name: g.mother_name, sub: t('field.motherWord') };

/** The first form of a visit, carrying the rest so they follow one after another. */
export const visitUrl = (motherId: number, childId: number | null, forms: FormCode[]) => {
  const [first, ...rest] = sortForms(forms);
  return formRunUrl(first, motherId, childId, flowString('visit', rest));
};
