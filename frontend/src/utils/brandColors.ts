/**
 * JS-side copies of the palette, for places CSS variables cannot reach: chart
 * colours computed in script, canvas/PNG exports and XLSX cell fills.
 * Source of truth: src/styles/theme.css. Keep the two in step.
 */
export const BRAND_600 = '#156877';
export const SUCCESS_500 = '#228049';
export const AMBER_500 = '#C28100';
export const ERROR_500 = '#C62828';
export const GRAY_100 = '#EDF1F3';
export const GRAY_400 = '#9FAAB3';
export const INK = '#0E1419';

/**
 * WHO growth-chart percentile curve colors (P3…P97). Each percentile gets its
 * own hue; P50 stays green as on printed WHO/MCP charts.
 */
export const PERCENTILE_COLORS = {
  p3: '#DC2626', // red
  p15: '#F97316', // orange
  p50: '#16A34A', // green (median)
  p85: '#0EA5E9', // sky
  p97: '#A855F7', // purple
} as const;

/**
 * Growth-chart visit colors by data source: which forms were filled on the
 * visit that produced the measurement. None of these hues is one of the
 * percentile curves' (red, orange, green, sky, purple): with a teal dot near
 * the green median, nobody could tell "growth check only" from P50 (review
 * of 19 Oct 2026). Dark and saturated, so dots read against the thin curves.
 */
export const GROWTH_SOURCE_COLORS = {
  birth: '#9CA3AF', // light grey — birth record from child registration
  growth: '#111827', // black — Check Growth only
  growth_bf: '#1E3A8A', // navy — Check Growth + Breastfeeding assessment
  growth_cf: '#92400E', // brown — Check Growth + Complementary feeding
  growth_bf_cf: '#DB2777', // pink — all three on one visit
} as const;

/**
 * Categorical series for the Results insights charts (one colour per cadre,
 * block, …): the brand teal first, then hues that stay distinguishable from
 * each other on both the light and the dark surface.
 */
export const CHART_SERIES = [
  '#156877', // teal (brand)
  '#C2410C', // burnt orange
  '#C28100', // ochre
  '#4F6FA8', // slate blue
  '#8A5AA8', // plum
  '#3E8E5A', // green
  '#A26A42', // clay
  '#C2507F', // rose
  '#6B7A88', // grey
  '#8C9A2E', // olive
] as const;

/** Traffic-light tones for "how good is this rate": the status colours of theme.css. */
export const TONE_GOOD = SUCCESS_500;
export const TONE_OK = AMBER_500;
export const TONE_LOW = ERROR_500;

/** Score bands on the Results test pages: excellent / passed / just missed / needs support. */
export const BAND_COLORS = {
  excellent: SUCCESS_500,
  passed: '#74BF8E',
  nearMiss: AMBER_500,
  support: ERROR_500,
} as const;

/** Two tests compared side by side: the first teal, the second burnt orange. */
export const TEST_A_COLOR = BRAND_600;
export const TEST_B_COLOR = '#C2410C';
