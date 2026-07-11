/**
 * JS-side copies of brand palette hexes.
 * Source of truth: src/styles/theme.css (@theme). Keep in sync.
 * Used where CSS variables can't reach: runtime-created DOM (confetti)
 * and XLSX cell fills (AdminTestsPage export).
 */
export const CORAL_500 = '#E85D4C';
export const CORAL_300 = '#F5A794';
export const SAGE_500 = '#7A9B76';
export const TEAL_500 = '#0FADA0';
export const AMBER_500 = '#F59E0B';
export const SUCCESS_500 = '#2F9E56';
export const ERROR_500 = '#DC2F2F';
export const CREAM_100 = '#F8F5EF';
export const INK_900 = '#26221C';

/** Celebratory confetti palette (warm-human brand). */
export const CONFETTI_COLORS = [CORAL_500, SAGE_500, TEAL_500, AMBER_500, SUCCESS_500, CORAL_300];
