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

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/** A dashed line across the bars: the 100% target, or the district average
 *  of one series (review of 7 Oct 2026) in that series' colour. */
export interface RefLine { value: number; label: string; color?: string }

/** The average over everyone shown, of each series, as reference lines. */
export const averageLines = (series: ColumnSeries[], totals: (number | null)[], label: (s: ColumnSeries) => string): RefLine[] =>
  series.flatMap((s, i) => (totals[i] == null ? [] : [{ value: totals[i]!, label: label(s), color: s.color }]));

// ── Cumulative charts: day / week / month / quarter ──────────────────────────

export type Grain = 'day' | 'week' | 'month' | 'quarter';
export const GRAINS: Grain[] = ['day', 'week', 'month', 'quarter'];

/** The last day of each period (a cumulative series closes each period on its last value). */
export function byGrain<T extends { date: string }>(days: T[], grain: Grain): T[] {
  if (grain === 'day') return days;
  const key = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (grain === 'week') {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return monday.toISOString().slice(0, 10);
    }
    if (grain === 'month') return iso.slice(0, 7);
    return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  };
  const out: T[] = [];
  for (const d of days) {
    if (out.length && key(out[out.length - 1].date) === key(d.date)) out[out.length - 1] = d;
    else out.push(d);
  }
  return out;
}

