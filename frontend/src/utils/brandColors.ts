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
