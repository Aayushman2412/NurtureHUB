/**
 * Shared numeric-answer validation for the "numerical" answer type — used by
 * flat number fields, flow number questions and numeric matrix columns.
 *
 * Two kinds of rule:
 *  - decimals (hard): at most N decimal places (default 1 for the numerical type).
 *  - flag range (soft): a value below flagMin or above flagMax is still accepted
 *    and stored, but flagged to the learner + admin. It does NOT block submit.
 */
import type { NumericRange } from './flowTypes';

/** Count decimal places in a raw numeric string. */
export const decimalPlaces = (raw: string): number => {
  const dot = raw.indexOf('.');
  return dot < 0 ? 0 : raw.trim().length - dot - 1;
};

export interface NumericFlag {
  /** i18n key under the caller's namespace (e.g. runner.outOfRange). */
  key: 'numberInvalid' | 'decimalsExceeded' | 'outOfRange';
  params?: Record<string, unknown>;
}

/**
 * Validate a raw numeric string against a NumericRange. Returns the first
 * problem, or null when valid/empty. Empty is treated as valid here (required
 * handling lives elsewhere).
 */
export function numberFlagState(raw: string, numeric?: NumericRange | null): NumericFlag | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { key: 'numberInvalid' };

  const decimals = numeric?.decimals;
  if (decimals != null && decimalPlaces(trimmed) > decimals) {
    return { key: 'decimalsExceeded', params: { decimals } };
  }

  const { flagMin = null, flagMax = null } = numeric ?? {};
  if ((flagMin != null && n < flagMin) || (flagMax != null && n > flagMax)) {
    return {
      key: 'outOfRange',
      params: {
        min: flagMin != null ? flagMin : '−∞',
        max: flagMax != null ? flagMax : '∞',
      },
    };
  }
  return null;
}

/** True when the value is outside the soft flag range (ignores decimals/parse). */
export function isOutOfFlagRange(raw: string, numeric?: NumericRange | null): boolean {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return false;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return false;
  const { flagMin = null, flagMax = null } = numeric ?? {};
  return (flagMin != null && n < flagMin) || (flagMax != null && n > flagMax);
}
