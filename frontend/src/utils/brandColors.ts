/**
 * JS-side copies of brand palette hexes.
 * Source of truth: src/styles/theme.css (@theme). Keep in sync.
 * Used where CSS variables can't reach: runtime-created DOM (confetti)
 * and XLSX cell fills (AdminTestsPage export).
 */
export const CORAL_500 = '#E85D4C';
export const CORAL_600 = '#D14432';
export const CORAL_300 = '#F5A794';
export const SAGE_500 = '#7A9B76';
export const AMBER_500 = '#F59E0B';
export const SUCCESS_500 = '#2F9E56';
export const ERROR_500 = '#DC2F2F';
export const CREAM_100 = '#F8F5EF';
export const INK_900 = '#26221C';

/** Celebratory confetti palette (warm-human brand). */
export const CONFETTI_COLORS = [CORAL_500, SAGE_500, CORAL_600, AMBER_500, SUCCESS_500, CORAL_300];

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
 * visit that produced the measurement. Kept visually distinct from the
 * percentile hues above (points/lines render bolder than the thin curves).
 */
export const GROWTH_SOURCE_COLORS = {
  birth: '#64748B', // slate — birth record from child registration
  growth: '#0F766E', // teal — Check Growth only
  growth_bf: '#1D4ED8', // blue — Check Growth + Breastfeeding assessment
  growth_cf: '#BE185D', // pink — Check Growth + Complementary feeding
  growth_bf_cf: '#7C3AED', // violet — all three on one visit
} as const;

/**
 * Categorical series for the Results insights charts (one colour per cadre,
 * block, …). Brand coral / sage / amber first, then muted companions that
 * stay distinguishable on both the cream and the dark surface.
 */
export const CHART_SERIES = [
  '#E85D4C', // coral
  '#5F7F5B', // sage
  '#F59E0B', // amber
  '#4F7CAC', // dusty blue
  '#9A6FB0', // plum
  '#2E9C95', // teal
  '#C98B5B', // clay
  '#D6679A', // rose
  '#7C8A99', // slate
  '#A3A847', // olive
] as const;

/** Traffic-light tones for "how good is this rate". */
export const TONE_GOOD = '#2F9E56';
export const TONE_OK = '#F59E0B';
export const TONE_LOW = '#DC2F2F';

/** Score bands on the Results test pages: excellent / passed / just missed / needs support. */
export const BAND_COLORS = {
  excellent: '#2F9E56',
  passed: '#7FC49A',
  nearMiss: '#F59E0B',
  support: '#DC2F2F',
} as const;

/** Two tests compared side by side: the first coral, the second dusty blue. */
export const TEST_A_COLOR = '#E85D4C';
export const TEST_B_COLOR = '#4F7CAC';
