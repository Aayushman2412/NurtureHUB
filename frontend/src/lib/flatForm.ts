/**
 * Dynamic form engine for `flat` form definitions (Check Growth, etc.).
 *
 * The admin defines an ordered field list (with conditional display rules and
 * numeric/date constraints); this module evaluates visibility against the
 * current answers + child age and builds a Zod schema for exactly the visible
 * fields — hidden fields are neither validated nor submitted.
 *
 * Zod messages are produced already-translated (the builder receives `t`), so
 * they flow through `toFieldErrors` unchanged (it passes unknown keys through).
 */

import { z } from 'zod';
import { OTHER_OPTION_VALUE } from './flowTypes';
import type { FlatField, FlatFieldCondition } from './flowTypes';

/** field id → value. Checkbox fields hold string[]; everything else a string. */
export type FlatFormValues = Record<string, string | string[]>;

/**
 * Where a semi-open field parks its typed "Other" text.
 *
 * It rides in the same values map under a derived key rather than a second
 * piece of state, so drafts, offline queueing and rehydration carry it around
 * for free. It is stripped back out when the payload is built.
 */
export const otherTextKey = (fieldId: string): string => `${fieldId}__other`;

/** True when this field's answer currently includes the "Other" option. */
export const isOtherSelected = (field: FlatField, values: FlatFormValues): boolean => {
  if (!field.allowOther || !isChoiceField(field)) return false;
  const v = values[field.id];
  return Array.isArray(v) ? v.includes(OTHER_OPTION_VALUE) : v === OTHER_OPTION_VALUE;
};

export interface FlatFormContext {
  /** react-i18next `t` (or any translator) — used at schema-build time. */
  t: (key: string, params?: Record<string, unknown>) => string;
  /** Child's age in days at the assessment date; null when unknown. */
  ageDays: number | null;
  /** Child's date of birth (ISO) for `notBeforeDob` date rules; null when unknown. */
  dobIso: string | null;
}

export const isChoiceField = (f: FlatField): boolean =>
  f.type === 'dropdown' || f.type === 'radio' || f.type === 'checkbox';

/** Initial values map: '' for scalars, [] for checkboxes. */
export function emptyFlatValues(fields: FlatField[]): FlatFormValues {
  const out: FlatFormValues = {};
  for (const f of fields) {
    out[f.id] = f.type === 'checkbox' ? [] : '';
    if (f.allowOther && isChoiceField(f)) out[otherTextKey(f.id)] = '';
  }
  return out;
}

const conditionHolds = (
  c: FlatFieldCondition,
  values: FlatFormValues,
  ageDays: number | null,
): boolean => {
  if (c.kind === 'ageLtDays') return ageDays != null && c.days != null && ageDays < c.days;
  if (c.kind === 'ageGteDays') return ageDays != null && c.days != null && ageDays >= c.days;
  // kind 'field'
  if (!c.fieldId || !c.anyOf || c.anyOf.length === 0) return true;
  const v = values[c.fieldId];
  const selected = Array.isArray(v) ? v : v ? [v] : [];
  return selected.some(s => c.anyOf!.includes(s));
};

/** A field is visible when ALL of its conditions hold (no conditions = always). */
export function isFieldVisible(
  field: FlatField,
  values: FlatFormValues,
  ageDays: number | null,
): boolean {
  if (!field.showIf || field.showIf.length === 0) return true;
  return field.showIf.every(c => conditionHolds(c, values, ageDays));
}

export function visibleFlatFields(
  fields: FlatField[],
  values: FlatFormValues,
  ageDays: number | null,
): FlatField[] {
  return fields.filter(f => isFieldVisible(f, values, ageDays));
}

// ── Zod schema ───────────────────────────────────────────────────────────────

const numberOf = (raw: string): number | null => {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
};

const decimalsOk = (raw: string, decimals: number): boolean => {
  const frac = raw.trim().split('.')[1] ?? '';
  return frac.length <= decimals;
};

function zodForField(f: FlatField, ctx: FlatFormContext): z.ZodTypeAny {
  const { t } = ctx;
  const requiredMsg = t('assessments:growth.validation.required', { label: f.label });

  if (f.type === 'checkbox') {
    let s = z.array(z.string());
    if (f.required) s = s.min(1, t('assessments:growth.validation.selectAtLeastOne'));
    return s;
  }

  if (f.type === 'number') {
    return z
      .string()
      .superRefine((raw, issueCtx) => {
        const trimmed = raw.trim();
        if (!trimmed) {
          if (f.required) issueCtx.addIssue({ code: 'custom', message: requiredMsg });
          return;
        }
        const n = numberOf(trimmed);
        if (n == null) {
          issueCtx.addIssue({ code: 'custom', message: t('assessments:growth.validation.number') });
          return;
        }
        const min = f.min ?? null;
        const max = f.max ?? null;
        if ((min != null && n < min) || (max != null && n > max)) {
          issueCtx.addIssue({
            code: 'custom',
            message: t('assessments:growth.validation.range', { min: min ?? '−∞', max: max ?? '∞' }),
          });
          return;
        }
        if (f.decimals != null && !decimalsOk(trimmed, f.decimals)) {
          issueCtx.addIssue({
            code: 'custom',
            message: t('assessments:growth.validation.decimals', { n: f.decimals }),
          });
        }
      });
  }

  if (f.type === 'date') {
    return z.string().superRefine((raw, issueCtx) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        if (f.required) issueCtx.addIssue({ code: 'custom', message: requiredMsg });
        return;
      }
      const d = new Date(`${trimmed.slice(0, 10)}T00:00:00`);
      if (Number.isNaN(d.getTime())) {
        issueCtx.addIssue({ code: 'custom', message: t('assessments:growth.validation.date') });
        return;
      }
      if (f.noFuture) {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (d.getTime() > today.getTime()) {
          issueCtx.addIssue({ code: 'custom', message: t('assessments:growth.validation.dateFuture') });
          return;
        }
      }
      if (f.notBeforeDob && ctx.dobIso) {
        const dob = new Date(`${ctx.dobIso.slice(0, 10)}T00:00:00`);
        if (!Number.isNaN(dob.getTime()) && d.getTime() < dob.getTime()) {
          issueCtx.addIssue({ code: 'custom', message: t('assessments:growth.validation.dateBeforeDob') });
        }
      }
    });
  }

  // text / textarea / dropdown / radio / image — all stored as a string.
  let s = z.string();
  if (f.required) s = s.trim().min(1, requiredMsg) as unknown as z.ZodString;
  return s;
}

/**
 * Zod schema for the currently VISIBLE fields only. Rebuild whenever values,
 * the definition or the language change (visibility depends on values).
 */
export function buildFlatZodSchema(
  fields: FlatField[],
  values: FlatFormValues,
  ctx: FlatFormContext,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of visibleFlatFields(fields, values, ctx.ageDays)) {
    shape[f.id] = zodForField(f, ctx);
    // A picked "Other" with nothing typed beside it is not an answer, so the
    // text is required whenever the option is selected — required field or not.
    if (f.allowOther && isChoiceField(f)) {
      const needsText = isOtherSelected(f, values);
      shape[otherTextKey(f.id)] = z.string().superRefine((raw, issueCtx) => {
        if (needsText && !raw.trim()) {
          issueCtx.addIssue({
            code: 'custom',
            message: ctx.t('assessments:growth.validation.otherRequired'),
          });
        }
      });
    }
  }
  return z.object(shape);
}

/** The value keys a schema built from these fields expects — field ids plus the
 *  "Other" text slots. Callers parse exactly this subset. */
export function flatSchemaKeys(visible: FlatField[]): string[] {
  const keys: string[] = [];
  for (const f of visible) {
    keys.push(f.id);
    if (f.allowOther && isChoiceField(f)) keys.push(otherTextKey(f.id));
  }
  return keys;
}

// ── Submission payload ───────────────────────────────────────────────────────

/**
 * Convert values → the generic AnswerIn wire shape (same endpoint as the flow
 * runner): choice fields put option values in `optionIds`, scalar fields use
 * `value`. Only visible fields are included.
 */
export function buildFlatAnswersPayload(
  fields: FlatField[],
  values: FlatFormValues,
  ageDays: number | null,
): { nodeId: string; optionIds: string[]; value: string | null }[] {
  const out: { nodeId: string; optionIds: string[]; value: string | null }[] = [];
  for (const f of visibleFlatFields(fields, values, ageDays)) {
    const v = values[f.id];
    if (isChoiceField(f)) {
      const selected = Array.isArray(v) ? v : v ? [v] : [];
      if (selected.length === 0) continue;
      // Semi-open field: the typed text rides along in `value`, which choice
      // fields otherwise leave null. The server pairs it with the sentinel.
      const otherText = isOtherSelected(f, values)
        ? String(values[otherTextKey(f.id)] ?? '').trim()
        : '';
      out.push({ nodeId: f.id, optionIds: selected, value: otherText || null });
    } else {
      const raw = typeof v === 'string' ? v.trim() : '';
      if (!raw) continue;
      out.push({ nodeId: f.id, optionIds: [], value: raw });
    }
  }
  return out;
}
