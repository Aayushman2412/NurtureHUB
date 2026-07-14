import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';

// `msg` values are i18n keys (validation:*) resolved in toFieldErrors at validation time.
const requiredStr = (msg: string) => z.string().refine(v => v.trim().length > 0, { message: msg });
const requiredRange = (min: number, max: number, msg: string) =>
  z.union([z.number(), z.literal('')]).refine(v => typeof v === 'number' && v >= min && v <= max, { message: msg });

const toDate = (s: string) => (s ? new Date(s) : null);
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export const childSchema = z
  .object({
    // Birth
    babies_born: requiredStr('validation:child.babiesBorn'),
    adoption_date: requiredStr('validation:child.adoptionRequired'),
    child_name: requiredStr('validation:child.nameRequired').refine(v => v.trim().length >= 2, { message: 'validation:common.min2Chars' }),
    dob: requiredStr('validation:common.dobRequired'),
    birth_weight: requiredRange(1, 5, 'validation:child.birthWeight'),
    birth_length: requiredRange(30, 65, 'validation:child.birthLength'),
    gender: requiredStr('validation:child.gender'),
    previous_living_children: requiredRange(0, 10, 'validation:child.previousChildren'),
    // Delivery & feeding
    delivery_method: requiredStr('validation:child.deliveryMethod'),
    delivery_place: requiredStr('validation:child.deliveryPlace'),
    delivery_place_other: z.string().optional(),
    bf_within_one_hour: requiredStr('validation:common.answerQuestion'),
    ebf_during_stay: requiredStr('validation:common.answerQuestion'),
    ebf_reason: z.string().optional(),
    // Conditions (not required; "Others" reveals a text field)
    birth_conditions: z.array(z.string()),
    pre_existing_other: z.string().optional(),
    // Derived flags (drive conditional-required rules)
    showDeliveryPlaceOther: z.boolean().optional(),
    showEbfReason: z.boolean().optional(),
    showConditionOther: z.boolean().optional(),
    isEdit: z.boolean().optional(),   // editing an existing record → skip registration-time freshness bounds
  })
  .superRefine((v, ctx) => {
    const today = new Date();
    const dob = toDate(v.dob);
    if (dob) {
      if (daysBetween(dob, today) > 0) ctx.addIssue({ code: 'custom', path: ['dob'], message: 'validation:common.dobFuture' });
      else if (!v.isEdit && daysBetween(today, dob) > 365) ctx.addIssue({ code: 'custom', path: ['dob'], message: 'validation:child.dob365' });
    }
    const adoption = toDate(v.adoption_date);
    if (adoption) {
      if (daysBetween(adoption, today) > 0) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:common.adoptionFuture' });
      else if (!v.isEdit && daysBetween(today, adoption) > 14) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:child.adoption14' });
      if (dob && adoption < dob) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:common.adoptionBeforeDob' });
    }
    if (v.showDeliveryPlaceOther && !v.delivery_place_other?.trim())
      ctx.addIssue({ code: 'custom', path: ['delivery_place_other'], message: 'validation:child.deliveryPlaceOther' });
    if (v.showEbfReason && !v.ebf_reason?.trim())
      ctx.addIssue({ code: 'custom', path: ['ebf_reason'], message: 'validation:child.ebfReason' });
    if (v.showConditionOther && !v.pre_existing_other?.trim())
      ctx.addIssue({ code: 'custom', path: ['pre_existing_other'], message: 'validation:child.conditionOther' });
  });

export type ChildFormValues = z.input<typeof childSchema>;

export const CR_STEP_FIELDS: readonly (readonly string[])[] = [
  ['babies_born', 'adoption_date', 'child_name', 'dob', 'birth_weight', 'birth_length', 'gender', 'previous_living_children'],
  ['delivery_method', 'delivery_place', 'delivery_place_other', 'bf_within_one_hour', 'ebf_during_stay', 'ebf_reason', 'birth_conditions', 'pre_existing_other'],
];

export function validateChild(values: ChildFormValues): FieldErrors {
  return toFieldErrors(childSchema.safeParse(values));
}

export function validateChildStep(values: ChildFormValues, step: number): FieldErrors {
  return pickErrors(validateChild(values), CR_STEP_FIELDS[step] ?? []);
}
