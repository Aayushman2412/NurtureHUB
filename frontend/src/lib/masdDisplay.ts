/** Shared colours and formatting for the MASD dashboard (components/masd). */
import { toneColor } from './resultsInsights';

export const MASD_COLORS = {
  adoption: '#2A7F8F',
  activity: '#E85D4C',
  then: '#A8A29E',
  anc: '#7C5CBF',
  protein: '#E0A11B',
  gm: '#2A7F8F',
  bf: '#E85D4C',
  cf: '#5C9E3C',
  pnc_lt5: '#E85D4C',
  pnc_ge5: '#2A7F8F',
  unknown: '#A8A29E',
  mtfl: '#2A7F8F',
  other: '#E85D4C',
} as const;

/** Rates in this report: green ≥80, amber 60–79, red below (as in the analysts' deck). */
export const rateTone = (v: number) => toneColor(v, 80, 60);

export const fmt1 = (v: number | null | undefined, suffix = '%') =>
  v == null ? '—' : `${v.toFixed(1)}${suffix}`;
