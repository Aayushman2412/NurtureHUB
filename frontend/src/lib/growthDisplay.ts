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
// A 7-stop ramp (deep red → red → orange → amber → lime → green → deep green)
// rather than a plain hue sweep: the extra stops and the stronger alpha make
// neighbouring values easy to tell apart at a glance. Fills stay translucent
// so the ink text keeps its contrast on both the light and dark surfaces.

/** Anchor colours of the ramp, evenly spaced from t=0 (worst) to t=1 (best). */
const SPECTRUM_STOPS: [number, number, number][] = [
  [176, 0, 32],    // deep red
  [226, 61, 40],   // red
  [245, 124, 0],   // orange
  [245, 197, 24],  // amber
  [168, 201, 58],  // lime
  [76, 175, 80],   // green
  [27, 127, 59],   // deep green
];

const DEFAULT_ALPHA = 0.55;

const rampRgb = (t: number): [number, number, number] => {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (SPECTRUM_STOPS.length - 1);
  const i = Math.min(Math.floor(scaled), SPECTRUM_STOPS.length - 2);
  const f = scaled - i;
  const [r1, g1, b1] = SPECTRUM_STOPS[i];
  const [r2, g2, b2] = SPECTRUM_STOPS[i + 1];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return [mix(r1, r2), mix(g1, g2), mix(b1, b2)];
};

const spectrum = (t: number, alpha = DEFAULT_ALPHA): string => {
  const [r, g, b] = rampRgb(t);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// WCAG relative luminance + contrast ratio, so the ink choice below is a real
// measurement rather than a guess about which side of "mid grey" a fill is on.
const relativeLuminance = ([r, g, b]: [number, number, number]): number => {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: [number, number, number], b: [number, number, number]): number => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE: [number, number, number] = [255, 255, 255];
const DARK_INK: [number, number, number] = [38, 34, 28]; // --color-cream-900

/**
 * Whether white text beats the dark ink on this fill.
 *
 * The fill is translucent, so it is judged against the LIGHT surface — the
 * worst case, since compositing the same colour over the dark surface only
 * darkens it further and can never flip the winner towards dark ink.
 */
export const spectrumNeedsLightInk = (t: number, alpha = DEFAULT_ALPHA): boolean => {
  const [r, g, b] = rampRgb(t);
  const composited: [number, number, number] = [
    alpha * r + (1 - alpha) * 255,
    alpha * g + (1 - alpha) * 255,
    alpha * b + (1 - alpha) * 255,
  ];
  return contrast(WHITE, composited) > contrast(DARK_INK, composited);
};

/**
 * z-score fill: deep red at ≤ −3, red around −2, through amber, reaching full
 * green at 0 and staying green above. Values past ±3 SD get the extra-opaque
 * treatment so clinically flagged rows stand out from merely low/high ones.
 */
/** ±3 SD and beyond is painted near-solid so the flag is unmistakable. */
const zAlpha = (z: number) => (Math.abs(z) >= 3 ? 0.92 : DEFAULT_ALPHA);

export const zCellFill = (z: number | null): string | undefined =>
  z == null ? undefined : spectrum((z + 3) / 3, zAlpha(z));

/** Tailwind text class for a z cell — white where the fill is too dark for ink. */
export const zCellInk = (z: number | null): string =>
  z == null
    ? 'text-ink-faint'
    : spectrumNeedsLightInk((z + 3) / 3, zAlpha(z))
      ? 'text-white'
      : 'text-ink';

/**
 * Count-percentage fill. AC: 0 % of expected = red → 100 %+ = green.
 * With `invert` (IC): 0 % incomplete = green → 100 % = red.
 */
export const pctCellFill = (pct: number | null, invert = false): string | undefined =>
  pct == null ? undefined : spectrum((invert ? 100 - pct : pct) / 100);

/**
 * Fill for a LAP verdict cell: green = as per LAP, red = not as per LAP.
 *
 * `tint` is for cells that also carry a ✓/✕ glyph — a light wash keeps the
 * saturated glyph readable, where a solid fill would swallow it.
 */
export const lapCellFill = (
  verdict: 'green' | 'red' | 'neutral' | null,
  tint = false,
): string | undefined => {
  const alpha = tint ? 0.2 : 0.6;
  if (verdict === 'green') return spectrum(1, alpha);
  if (verdict === 'red') return spectrum(0, alpha);
  return undefined;
};

/** Tailwind text class for a solid (non-tinted) LAP fill. */
export const lapCellInk = (verdict: 'green' | 'red' | 'neutral' | null): string => {
  if (verdict !== 'green' && verdict !== 'red') return 'text-ink';
  return spectrumNeedsLightInk(verdict === 'green' ? 1 : 0, 0.6) ? 'text-white' : 'text-ink';
};

/**
 * Fill for a z-score CHANGE between visits (Δz). Improvement (positive) is
 * green, deterioration is red; ±1 SD saturates the ramp.
 */
export const deltaCellFill = (delta: number | null): string | undefined =>
  delta == null ? undefined : spectrum((delta + 1) / 2, 0.5);

/** Tailwind text class for a Δz cell. */
export const deltaCellInk = (delta: number | null): string =>
  delta == null
    ? 'text-ink-faint'
    : spectrumNeedsLightInk((delta + 1) / 2, 0.5)
      ? 'text-white'
      : 'text-ink';
