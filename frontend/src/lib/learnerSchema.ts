import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';
import { TRAININGS } from './learnerFields';

// ── Reusable field validators (form state holds `number | ''` for empty selects) ──
// NOTE: `msg` values are i18n keys (validation:*) resolved in toFieldErrors at
// validation time — not literal English. Keeps error text translatable.
const requiredId = (msg: string) =>
  z.union([z.number(), z.literal('')]).refine(v => typeof v === 'number' && v > 0, { message: msg });

const requiredStr = (msg: string) =>
  z.string().refine(v => v.trim().length > 0, { message: msg });

const requiredRange = (min: number, max: number, msg: string) =>
  z.union([z.number(), z.literal('')]).refine(
    v => typeof v === 'number' && v >= min && v <= max, { message: msg });

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * The Learner Registration field schema. `isOtherDept` / `showQualificationOther`
 * are derived flags (not form fields) the component passes in so the schema can
 * express data-dependent conditionals; their issues attach to the relevant fields.
 */
export const learnerSchema = z
  .object({
    // Personal
    dob: requiredStr('validation:common.dobRequired'),
    age: z.union([z.number(), z.literal('')]).optional(),
    gender: requiredStr('validation:learner.gender'),
    phone: z.string().refine(v => /^\d{10}$/.test(digits(v)), { message: 'validation:common.phone10' }),
    alternatePhone: z.string().optional()
      .refine(v => !v || /^\d{10}$/.test(digits(v)), { message: 'validation:common.altPhone10' }),
    maritalStatus: requiredStr('validation:learner.marital'),
    hasChildren: requiredStr('validation:common.answerQuestion'),
    numberChildren: z.union([z.number(), z.literal('')]).optional(),
    // Work & location
    departmentId: requiredId('validation:learner.department'),
    departmentOther: z.string().optional(),
    designationId: requiredId('validation:learner.designation'),
    facilityTypeId: requiredId('validation:learner.facilityType'),
    stateId: requiredId('validation:common.selectState'),
    districtId: requiredId('validation:common.selectDistrict'),
    blockId: requiredId('validation:common.selectTaluk'),
    // Village: a known village (villageId) OR a free-typed name (villageName); one required.
    villageId: z.union([z.number(), z.literal('')]).optional(),
    villageName: z.string().optional(),
    facilityId: requiredId('validation:learner.facility'),
    residenceDistance: requiredRange(0, 100, 'validation:learner.distance'),
    // Education & experience
    qualificationId: requiredId('validation:learner.qualification'),
    qualificationOther: z.string().optional(),
    yearsService: requiredRange(0, 50, 'validation:learner.yearsService'),
    yearsDesignation: requiredRange(0, 50, 'validation:learner.yearsDesignation'),
    yearsFacility: requiredRange(0, 50, 'validation:learner.yearsFacility'),
    internetWorkplace: requiredStr('validation:common.selectOne'),
    // Training recency — a keyed record; each expected key is checked in superRefine.
    trainings: z.record(z.string(), z.string()),
    // Derived flags (inform conditionals; not stored as form fields)
    isOtherDept: z.boolean().optional(),
    showQualificationOther: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!(typeof v.villageId === 'number' && v.villageId > 0) && !v.villageName?.trim())
      ctx.addIssue({ code: 'custom', path: ['villageName'], message: 'validation:learner.village' });
    for (const t of TRAININGS) {
      if (!v.trainings?.[t.key]?.trim())
        ctx.addIssue({ code: 'custom', path: ['trainings', t.key], message: 'validation:common.answerQuestion' });
    }
    if (v.hasChildren === 'Yes' && (v.numberChildren === '' || v.numberChildren === undefined))
      ctx.addIssue({ code: 'custom', path: ['numberChildren'], message: 'validation:learner.numberChildren' });
    if (v.isOtherDept && !v.departmentOther?.trim())
      ctx.addIssue({ code: 'custom', path: ['departmentOther'], message: 'validation:learner.departmentOther' });
    if (v.showQualificationOther && !v.qualificationOther?.trim())
      ctx.addIssue({ code: 'custom', path: ['qualificationOther'], message: 'validation:learner.qualificationOther' });
    if (typeof v.yearsService === 'number') {
      if (typeof v.yearsDesignation === 'number' && v.yearsDesignation > v.yearsService)
        ctx.addIssue({ code: 'custom', path: ['yearsDesignation'], message: 'validation:learner.cannotExceedService' });
      if (typeof v.yearsFacility === 'number' && v.yearsFacility > v.yearsService)
        ctx.addIssue({ code: 'custom', path: ['yearsFacility'], message: 'validation:learner.cannotExceedService' });
    }
  });

export type LearnerFormValues = z.input<typeof learnerSchema>;

// Field keys per wizard step (for validating one step at a time).
export const LR_STEP_FIELDS: readonly (readonly string[])[] = [
  ['dob', 'age', 'gender', 'phone', 'alternatePhone', 'maritalStatus', 'hasChildren', 'numberChildren'],
  ['departmentId', 'departmentOther', 'designationId', 'facilityTypeId', 'stateId', 'districtId',
    'blockId', 'villageName', 'facilityId', 'residenceDistance'],
  ['qualificationId', 'qualificationOther', 'yearsService', 'yearsDesignation', 'yearsFacility', 'internetWorkplace'],
  ['trainings.nutrition_training', 'trainings.pregnancy_nutrition_training', 'trainings.breastfeeding_training',
    'trainings.complementary_feeding_training', 'trainings.growth_monitoring_training'],
];

/** Validate the whole form → field-error map. */
export function validateLearner(values: LearnerFormValues): FieldErrors {
  return toFieldErrors(learnerSchema.safeParse(values));
}

/** Validate only the fields belonging to `step`. */
export function validateLearnerStep(values: LearnerFormValues, step: number): FieldErrors {
  return pickErrors(validateLearner(values), LR_STEP_FIELDS[step] ?? []);
}
