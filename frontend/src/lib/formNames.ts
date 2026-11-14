/**
 * One name per form everywhere (Learner Redesign review, 30 Oct 2026: "the
 * same form has three names: 'Growth check', 'Check Growth Form' and
 * 'growth_monitoring'"). The learner's screens name a form by the words of
 * the worker app (dashboard `field.form.*`), never by the admin's title or
 * its key.
 */
import { FORM_KEY, type FormCode } from '../api/today';

const CODE_OF: Record<string, FormCode> = Object.fromEntries(
  Object.entries(FORM_KEY).map(([code, key]) => [key, code as FormCode]),
) as Record<string, FormCode>;

type T = (key: string, opts?: Record<string, unknown>) => string;

/** "Growth check" for growth_monitoring; null for a form the worker app does not name. */
export const formName = (formKey: string, t: T): string | null => {
  const code = CODE_OF[formKey];
  return code ? t(`field.form.${code}`, { ns: 'dashboard' }) : null;
};

/** The visit being filled, as names: this form, and the steps after it. */
export const formFlowChain = (formKey: string, rest: string[], t: T): { current: string | null; next: string[] } => ({
  current: formName(formKey, t),
  next: rest.map(step => (step === 'baby' ? t('field.form.baby', { ns: 'dashboard' }) : t(`field.form.${step}`, { ns: 'dashboard' }))),
});
