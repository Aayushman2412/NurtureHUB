import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';
import { TRAININGS, ageFromDob } from './learnerFields';

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
    dob: requiredStr('validation:common.dobRequired')
      .refine(v => {
        if (!v.trim()) return true;               // emptiness already reported above
        const age = ageFromDob(v);
        return typeof age === 'number' && age >= 18;
      }, { message: 'validation:learner.minAge18' }),
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
    // Designation/facility type: picked from the list, or free-text when department =
    // Other (selects hidden) or an "Other (Specify)" row is picked — see superRefine.
    designationId: z.union([z.number(), z.literal('')]).optional(),
    designationOther: z.string().optional(),
    facilityTypeId: z.union([z.number(), z.literal('')]).optional(),
    facilityTypeOther: z.string().optional(),
    stateId: requiredId('validation:common.selectState'),
    districtId: requiredId('validation:common.selectDistrict'),
    blockId: requiredId('validation:common.selectTaluk'),
    // Village: a known village (villageId) OR a free-typed name (villageName); one required.
    villageId: z.union([z.number(), z.literal('')]).optional(),
    villageName: z.string().optional(),
    // Facility: a known facility (facilityId) OR a free-typed name (facilityName); one required.
    facilityId: z.union([z.number(), z.literal('')]).optional(),
    facilityName: z.string().optional(),
    residenceDistance: requiredRange(0.1, 100, 'validation:learner.distance'),
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
    isOtherDesignation: z.boolean().optional(),
    isOtherFacilityType: z.boolean().optional(),
    showQualificationOther: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!(typeof v.villageId === 'number' && v.villageId > 0) && !v.villageName?.trim())
      ctx.addIssue({ code: 'custom', path: ['villageName'], message: 'validation:learner.village' });
    if (!(typeof v.facilityId === 'number' && v.facilityId > 0) && !v.facilityName?.trim())
      ctx.addIssue({ code: 'custom', path: ['facilityName'], message: 'validation:learner.facility' });
    for (const t of TRAININGS) {
      if (!v.trainings?.[t.key]?.trim())
        ctx.addIssue({ code: 'custom', path: ['trainings', t.key], message: 'validation:common.answerQuestion' });
    }
    if (v.hasChildren === 'Yes') {
      if (v.numberChildren === '' || v.numberChildren === undefined)
        ctx.addIssue({ code: 'custom', path: ['numberChildren'], message: 'validation:learner.numberChildren' });
      else if (v.numberChildren < 0 || v.numberChildren > 10)
        ctx.addIssue({ code: 'custom', path: ['numberChildren'], message: 'validation:learner.numberChildrenRange' });
    }
    if (v.isOtherDept && !v.departmentOther?.trim())
      ctx.addIssue({ code: 'custom', path: ['departmentOther'], message: 'validation:learner.departmentOther' });
    // Dept = Other: the selects are hidden — designation & facility type become free text.
    if (!v.isOtherDept) {
      if (!(typeof v.designationId === 'number' && v.designationId > 0))
        ctx.addIssue({ code: 'custom', path: ['designationId'], message: 'validation:learner.designation' });
      if (!(typeof v.facilityTypeId === 'number' && v.facilityTypeId > 0))
        ctx.addIssue({ code: 'custom', path: ['facilityTypeId'], message: 'validation:learner.facilityType' });
    }
    if ((v.isOtherDept || v.isOtherDesignation) && !v.designationOther?.trim())
      ctx.addIssue({ code: 'custom', path: ['designationOther'], message: 'validation:learner.designationOther' });
    if ((v.isOtherDept || v.isOtherFacilityType) && !v.facilityTypeOther?.trim())
      ctx.addIssue({ code: 'custom', path: ['facilityTypeOther'], message: 'validation:learner.facilityTypeOther' });
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
  ['departmentId', 'departmentOther', 'designationId', 'designationOther', 'facilityTypeId', 'facilityTypeOther',
    'stateId', 'districtId', 'blockId', 'villageName', 'facilityId', 'facilityName', 'residenceDistance'],
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
