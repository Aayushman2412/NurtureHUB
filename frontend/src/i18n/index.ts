import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enApp from './locales/en/app.json';
import enTutorials from './locales/en/tutorials.json';
import enDashboard from './locales/en/dashboard.json';
import enTests from './locales/en/tests.json';
import enLearner from './locales/en/learner.json';
import enMother from './locales/en/mother.json';
import enLanding from './locales/en/landing.json';
import hiCommon from './locales/hi/common.json';
import hiAuth from './locales/hi/auth.json';
import hiApp from './locales/hi/app.json';
import hiTutorials from './locales/hi/tutorials.json';
import hiDashboard from './locales/hi/dashboard.json';
import hiTests from './locales/hi/tests.json';
import hiLearner from './locales/hi/learner.json';
import hiMother from './locales/hi/mother.json';
import hiLanding from './locales/hi/landing.json';

/**
 * Languages the UI actually ships translations for. The switcher only offers
 * these — add a new entry (plus its locale JSON) to expose another language.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const NAMESPACES = ['common', 'auth', 'app', 'tutorials', 'dashboard', 'tests', 'learner', 'mother', 'landing'] as const;

const resources = {
  en: { common: enCommon, auth: enAuth, app: enApp, tutorials: enTutorials, dashboard: enDashboard, tests: enTests, learner: enLearner, mother: enMother, landing: enLanding },
  hi: { common: hiCommon, auth: hiAuth, app: hiApp, tutorials: hiTutorials, dashboard: hiDashboard, tests: hiTests, learner: hiLearner, mother: hiMother, landing: hiLanding },
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
