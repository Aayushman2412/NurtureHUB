import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';
import { TRAININGS } from './learnerFields';

// ── Reusable field validators (form state holds `number | ''` for empty selects) ──
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
    dob: requiredStr('Date of birth is required.'),
    age: z.union([z.number(), z.literal('')]).optional(),
    gender: requiredStr('Please select your gender.'),
    phone: z.string().refine(v => /^\d{10}$/.test(digits(v)), { message: 'Enter a valid 10-digit mobile number.' }),
    alternatePhone: z.string().optional()
      .refine(v => !v || /^\d{10}$/.test(digits(v)), { message: 'Alternate number must be 10 digits.' }),
    maritalStatus: requiredStr('Please select marital status.'),
    hasChildren: requiredStr('Please answer this question.'),
    numberChildren: z.union([z.number(), z.literal('')]).optional(),
    // Work & location
    departmentId: requiredId('Please select a department.'),
    departmentOther: z.string().optional(),
    designationId: requiredId('Please select a designation.'),
    facilityTypeId: requiredId('Please select a facility type.'),
    stateId: requiredId('Please select a state.'),
    districtId: requiredId('Please select a district.'),
    blockId: requiredId('Please select a taluk.'),
    // Village: a known village (villageId) OR a free-typed name (villageName); one required.
    villageId: z.union([z.number(), z.literal('')]).optional(),
    villageName: z.string().optional(),
    facilityId: requiredId('Please select a facility.'),
    residenceDistance: requiredRange(0, 100, 'Enter a distance between 0 and 100 km.'),
    // Education & experience
    qualificationId: requiredId('Please select a qualification.'),
    qualificationOther: z.string().optional(),
    yearsService: requiredRange(0, 50, 'Enter total years of service (0–50).'),
    yearsDesignation: requiredRange(0, 50, 'Enter years in current designation (0–50).'),
    yearsFacility: requiredRange(0, 50, 'Enter years at current facility (0–50).'),
    internetWorkplace: requiredStr('Please select one.'),
    // Training recency — a keyed record; each expected key is checked in superRefine.
    trainings: z.record(z.string(), z.string()),
    // Derived flags (inform conditionals; not stored as form fields)
    isOtherDept: z.boolean().optional(),
    showQualificationOther: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!(typeof v.villageId === 'number' && v.villageId > 0) && !v.villageName?.trim())
      ctx.addIssue({ code: 'custom', path: ['villageName'], message: 'Please select or enter a village.' });
    for (const t of TRAININGS) {
      if (!v.trainings?.[t.key]?.trim())
        ctx.addIssue({ code: 'custom', path: ['trainings', t.key], message: 'Please answer this question.' });
    }
    if (v.hasChildren === 'Yes' && (v.numberChildren === '' || v.numberChildren === undefined))
      ctx.addIssue({ code: 'custom', path: ['numberChildren'], message: 'Please enter the number of children.' });
    if (v.isOtherDept && !v.departmentOther?.trim())
      ctx.addIssue({ code: 'custom', path: ['departmentOther'], message: 'Please specify the department.' });
    if (v.showQualificationOther && !v.qualificationOther?.trim())
      ctx.addIssue({ code: 'custom', path: ['qualificationOther'], message: 'Please specify your qualification.' });
    if (typeof v.yearsService === 'number') {
      if (typeof v.yearsDesignation === 'number' && v.yearsDesignation > v.yearsService)
        ctx.addIssue({ code: 'custom', path: ['yearsDesignation'], message: 'Cannot exceed total years of service.' });
      if (typeof v.yearsFacility === 'number' && v.yearsFacility > v.yearsService)
        ctx.addIssue({ code: 'custom', path: ['yearsFacility'], message: 'Cannot exceed total years of service.' });
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
