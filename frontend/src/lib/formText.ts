/**
 * Visit forms in the learner's language, English underneath (Learner
 * Redesign review, 30 Oct 2026: "Marathi first, no English medical jargon";
 * the mockup shows the Marathi question with the English line below it).
 *
 * The forms are the admins' (form builder, versioned per project), so their
 * text is not in the app's string files. The Hindi and Marathi wording comes
 * from the review drafts (backend/scripts/translation_drafts/*.json — see
 * backend/scripts/build_form_translations.py) and is kept per form, node and
 * part, next to the English it was written for:
 *
 *   { "<form_key>": { "<node id>": { "title": { "en": "…", "tr": "…" },
 *                                    "help": { … }, "opt": { "<option id>": { "label": { … } } } } } }
 *
 * A translation is shown only while the form's English is still the English
 * it translates — an admin who rewords a question gets English until the
 * team translates the new words, never a translation of something else.
 * The files load on first use, so English learners never download them.
 */
import { useEffect, useState } from 'react';
import i18n from '../i18n';

type Entry = { en: string; tr: string };

const loaders = import.meta.glob('../i18n/locales/*/forms.json');
const loaded = new Set<string>(['en']);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const ensure = async (lang: string): Promise<void> => {
  if (loaded.has(lang)) return;
  const load = loaders[`../i18n/locales/${lang}/forms.json`];
  if (load) {
    const mod = (await load()) as { default: Record<string, unknown> };
    i18n.addResourceBundle(lang, 'forms', mod.default, true, true);
  }
  loaded.add(lang);
};

export interface FormWords {
  /** The words to show first; `english` is set when they are a translation. */
  main: string;
  english: string | null;
}

const lookup = (lang: string, path: string, english: string | undefined | null): FormWords => {
  const en = english ?? '';
  if (!en || lang === 'en') return { main: en, english: null };
  const entry = i18n.getResource(lang, 'forms', path) as Entry | undefined;
  if (entry && typeof entry === 'object' && entry.tr && norm(entry.en) === norm(en)) {
    return { main: entry.tr, english: en };
  }
  return { main: en, english: null };
};

/** Short English options ride beside the translation ("हो · Yes"). */
const SHORT_OPTION = 30;

export const optionLabel = (w: FormWords): string =>
  w.english && w.english.length <= SHORT_OPTION ? `${w.main} · ${w.english}` : w.main;

/** The form's text in the current language, for one form. */
export function useFormText(formKey: string) {
  const lang = (i18n.resolvedLanguage || 'en').split('-')[0];
  const [, setReady] = useState(loaded.has(lang));
  useEffect(() => {
    let alive = true;
    void ensure(lang).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [lang]);
  return {
    lang,
    title: (nodeId: string, en: string | undefined | null) => lookup(lang, `${formKey}.${nodeId}.title`, en),
    help: (nodeId: string, en: string | undefined | null) => lookup(lang, `${formKey}.${nodeId}.help`, en),
    placeholder: (nodeId: string, en: string | undefined | null) => lookup(lang, `${formKey}.${nodeId}.placeholder`, en),
    option: (nodeId: string, optionId: string, en: string | undefined | null) =>
      lookup(lang, `${formKey}.${nodeId}.opt.${optionId}.label`, en),
  };
}
