/**
 * How a baby's growth reads to the health worker (launch review of 19 Oct 2026).
 *
 * Dr Rupal: percentiles, not z-scores; green at or above −1 SD, yellow from −1
 * to −1.5, red below −1.5; and the colour always with a word (Abhay, Saisudha:
 * colours alone are hard to read). Mirrors backend app/fieldplan.py.
 */
import type { Status, Tone } from '../api/today';

/** Error function (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
const erf = (x: number): number => {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
};

/** The WHO percentile for a z-score, 1–99. */
export const percentileOf = (z: number | null | undefined): number | null =>
  z == null ? null : Math.max(1, Math.min(99, Math.round(50 * (1 + erf(z / Math.SQRT2)))));

export const toneOf = (z: number | null | undefined): Tone | null =>
  z == null ? null : z < -1.5 ? 'red' : z < -1 ? 'yellow' : 'green';

/** Fixed colours (not theme tokens) so a downloaded chart keeps them. */
export const TONE_HEX: Record<Tone, string> = { green: '#21753F', yellow: '#B45309', red: '#DC2F2F' };

export const TONE_CLASSES: Record<Status, { dot: string; soft: string; text: string; ring: string }> = {
  green: {
    dot: 'bg-success-500', soft: 'bg-success-50 dark:bg-success-500/15',
    text: 'text-success-600 dark:text-success-500', ring: 'ring-success-500/40',
  },
  yellow: {
    dot: 'bg-amber-500', soft: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-400', ring: 'ring-amber-500/40',
  },
  red: {
    dot: 'bg-error-500', soft: 'bg-error-50 dark:bg-error-500/15',
    text: 'text-error-600 dark:text-error-400', ring: 'ring-error-500/40',
  },
  none: {
    dot: 'bg-ink-faint', soft: 'bg-surface-sunken', text: 'text-ink-muted', ring: 'ring-border',
  },
};
