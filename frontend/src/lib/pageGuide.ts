import type { TFunction } from 'i18next';

/** Admin route → the guide that explains it (first match wins, so the more specific routes come first). */
const ROUTES: [RegExp, string][] = [
  [/^\/admin\/tests\/[^/]+\/monitor/, 'liveMonitor'],
  [/^\/admin\/tests/, 'tests'],
  [/^\/admin\/tutorial-tracking/, 'tutorialTracking'],
  [/^\/admin\/tutorials/, 'tutorials'],
  [/^\/admin\/results/, 'results'],
  [/^\/admin\/growth/, 'growth'],
  [/^\/admin\/masd/, 'masd'],
  [/^\/admin\/form-builder/, 'formBuilder'],
  [/^\/admin\/learners/, 'learners'],
  [/^\/admin\/(projects|districts)/, 'projects'],
  [/^\/admin\/data-protection/, 'dataProtection'],
  [/^\/admin\/database\/rawdata/, 'rawData'],
  [/^\/admin\/database\/crosstabs/, 'crosstabs'],
  [/^\/admin\/database\/masd/, 'masdPipeline'],
  [/^\/admin\/?$/, 'dashboard'],
];

export function guideKeyFor(pathname: string): string | null {
  return ROUTES.find(([re]) => re.test(pathname))?.[1] ?? null;
}

export interface GuideTerm { term: string; meaning: string }

/** A page's terms, in the order written — also used for the glossary sheet
 *  every Excel download of that page carries. */
export function guideTerms(t: TFunction, page: string): GuideTerm[] {
  const terms = t(`pages.${page}.terms`, { ns: 'guide', returnObjects: true }) as Record<string, GuideTerm> | string;
  return typeof terms === 'object' && terms ? Object.values(terms) : [];
}
