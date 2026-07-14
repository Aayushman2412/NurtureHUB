// Generic form-validation helpers shared by every form in the app.
// Pairs a Zod schema's result with the inline per-field error UI (Field/Input/Select
// all accept an `error`). Reused by LR now and MR/CR/etc. as they are built.

import i18n from '../i18n';

export type FieldErrors = Record<string, string>;

/** Structural shape of a Zod safeParse result — avoids depending on Zod's exported type names. */
interface ParseResult {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
}

/**
 * Flattens a Zod safeParse result into a { "field.path": message } map.
 * Nested paths join with "." (e.g. "trainings.nutrition_training"). Only the first
 * issue per field is kept, so each control shows one message.
 *
 * Schema messages are i18n keys (e.g. "validation:common.dobRequired"); each is
 * translated here at validation time using the current language. A message that is
 * not a known key passes through unchanged (i18next returns the input on a miss),
 * so plain-string messages still work.
 */
export function toFieldErrors(result: ParseResult): FieldErrors {
  if (result.success || !result.error) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    if (!errors[key]) errors[key] = i18n.t(issue.message);
  }
  return errors;
}

/** Narrow a full error map to just the keys belonging to one wizard step. */
export function pickErrors(all: FieldErrors, keys: readonly string[]): FieldErrors {
  const set = new Set(keys);
  const out: FieldErrors = {};
  for (const k of Object.keys(all)) if (set.has(k)) out[k] = all[k];
  return out;
}
