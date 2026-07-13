import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';

const requiredStr = (msg: string) => z.string().refine(v => v.trim().length > 0, { message: msg });
const requiredRange = (min: number, max: number, msg: string) =>
  z.union([z.number(), z.literal('')]).refine(v => typeof v === 'number' && v >= min && v <= max, { message: msg });

const toDate = (s: string) => (s ? new Date(s) : null);
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export const childSchema = z
  .object({
    // Birth
    babies_born: requiredStr('Please select whether this was a single or twin birth.'),
    adoption_date: requiredStr('Date of adoption is required.'),
    child_name: requiredStr('Baby’s name is required (min 2 characters).').refine(v => v.trim().length >= 2, { message: 'Enter at least 2 characters.' }),
    dob: requiredStr('Date of birth is required.'),
    birth_weight: requiredRange(1, 5, 'Enter a birth weight between 1.0 and 5.0 kg.'),
    birth_length: requiredRange(30, 65, 'Enter a birth length between 30 and 65 cm.'),
    sex: requiredStr('Please select the sex.'),
    previous_living_children: requiredRange(0, 10, 'Enter a number between 0 and 10.'),
    // Delivery & feeding
    delivery_method: requiredStr('Please select the delivery method.'),
    delivery_place: requiredStr('Please select the place of delivery.'),
    delivery_place_other: z.string().optional(),
    bf_within_one_hour: requiredStr('Please answer this question.'),
    ebf_during_stay: requiredStr('Please answer this question.'),
    ebf_reason: z.string().optional(),
    // Conditions (not required; "Others" reveals a text field)
    birth_conditions: z.array(z.string()),
    pre_existing_other: z.string().optional(),
    // Derived flags (drive conditional-required rules)
    showDeliveryPlaceOther: z.boolean().optional(),
    showEbfReason: z.boolean().optional(),
    showConditionOther: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const today = new Date();
    const dob = toDate(v.dob);
    if (dob) {
      if (daysBetween(dob, today) > 0) ctx.addIssue({ code: 'custom', path: ['dob'], message: 'Date of birth cannot be in the future.' });
      else if (daysBetween(today, dob) > 365) ctx.addIssue({ code: 'custom', path: ['dob'], message: 'Date of birth cannot be more than 365 days ago.' });
    }
    const adoption = toDate(v.adoption_date);
    if (adoption) {
      if (daysBetween(adoption, today) > 0) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'Adoption date cannot be in the future.' });
      else if (daysBetween(today, adoption) > 14) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'Adoption date cannot be more than 14 days ago.' });
    }
    if (v.showDeliveryPlaceOther && !v.delivery_place_other?.trim())
      ctx.addIssue({ code: 'custom', path: ['delivery_place_other'], message: 'Please specify the place of delivery.' });
    if (v.showEbfReason && !v.ebf_reason?.trim())
      ctx.addIssue({ code: 'custom', path: ['ebf_reason'], message: 'Please give the reason exclusive breastfeeding was not done.' });
    if (v.showConditionOther && !v.pre_existing_other?.trim())
      ctx.addIssue({ code: 'custom', path: ['pre_existing_other'], message: 'Please specify the other condition(s).' });
  });

export type ChildFormValues = z.input<typeof childSchema>;

export const CR_STEP_FIELDS: readonly (readonly string[])[] = [
  ['babies_born', 'adoption_date', 'child_name', 'dob', 'birth_weight', 'birth_length', 'sex', 'previous_living_children'],
  ['delivery_method', 'delivery_place', 'delivery_place_other', 'bf_within_one_hour', 'ebf_during_stay', 'ebf_reason', 'birth_conditions', 'pre_existing_other'],
];

export function validateChild(values: ChildFormValues): FieldErrors {
  return toFieldErrors(childSchema.safeParse(values));
}

export function validateChildStep(values: ChildFormValues, step: number): FieldErrors {
  return pickErrors(validateChild(values), CR_STEP_FIELDS[step] ?? []);
}
