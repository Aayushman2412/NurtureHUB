/**
 * Shared display helpers for the growth-monitor summary table and the case
 * drill-down modal: adoption-age categorisation, "Xm Yd" age formatting, and
 * the Excel-style red→green spectrum used to fill value cells.
 */

export type AdoptionCategory = 'antenatal' | 'under5m' | 'over5m';

/** Split an age/duration in days into whole months + leftover days (mean month = 30.4375 d). */
export const monthsDays = (days: number | null): { m: number; d: number } | null => {
  if (days == null || days < 0) return null;
  const m = Math.floor(days / 30.4375);
  return { m, d: Math.floor(days - m * 30.4375) };
};

/**
 * Bucket a case by the child's age at adoption (negative days = antenatal).
 * Derived from the same monthsDays arithmetic that formats the Adopt-age
 * column, so the bucket and the displayed "Xm Yd" can never contradict.
 */
export const adoptionCategory = (days: number | null): AdoptionCategory | null =>
  days == null ? null : days < 0 ? 'antenatal' : monthsDays(days)!.m < 5 ? 'under5m' : 'over5m';

// ── Excel-style spectrum cell fills ──────────────────────────────────────────
// Hue runs 0 (red) → 120 (green). Translucent fills keep the ink text readable
// and work over both the light and the dark surface colours.

const spectrum = (t: number, alpha = 0.32): string =>
  `hsla(${Math.round(Math.max(0, Math.min(1, t)) * 120)}, 78%, 44%, ${alpha})`;

/**
 * z-score fill: deep red at ≤ −3, red around −2, through amber, reaching full
 * green at 0 and staying green above.
 */
export const zCellFill = (z: number | null): string | undefined =>
  z == null ? undefined : spectrum((z + 3) / 3, z <= -3 ? 0.5 : 0.32);

/**
 * Count-percentage fill. AC: 0 % of expected = red → 100 %+ = green.
 * With `invert` (IC): 0 % incomplete = green → 100 % = red.
 */
export const pctCellFill = (pct: number | null, invert = false): string | undefined =>
  pct == null ? undefined : spectrum((invert ? 100 - pct : pct) / 100);
