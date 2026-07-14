import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enApp from './locales/en/app.json';
import hiCommon from './locales/hi/common.json';
import hiAuth from './locales/hi/auth.json';
import hiApp from './locales/hi/app.json';

/**
 * Languages the UI actually ships translations for. The switcher only offers
 * these — add a new entry (plus its locale JSON) to expose another language.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const NAMESPACES = ['common', 'auth', 'app'] as const;

const resources = {
  en: { common: enCommon, auth: enAuth, app: enApp },
  hi: { common: hiCommon, auth: hiAuth, app: hiApp },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en', // missing keys/languages fall back to English — a partial
                       // translation never breaks a page.
    supportedLngs: SUPPORTED_LANGUAGES.map(l => l.code),
    defaultNS: 'common',
    ns: NAMESPACES as unknown as string[],
    interpolation: { escapeValue: false }, // React already escapes
    react: { useSuspense: false }, // resources are bundled (sync) — no Suspense boundary needed
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'nh_lang',
      caches: ['localStorage'],
    },
  });

// Keep <html lang> in sync so screen readers and the browser pick the right
// language, and re-apply on every switch.
const applyHtmlLang = (lng: string) => {
  document.documentElement.setAttribute('lang', lng);
};
applyHtmlLang(i18n.resolvedLanguage || 'en');
i18n.on('languageChanged', applyHtmlLang);

export default i18n;
