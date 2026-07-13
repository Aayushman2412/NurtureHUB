import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';
import { MATRIX_SOURCES } from './motherFields';

const requiredId = (msg: string) =>
  z.union([z.number(), z.literal('')]).refine(v => typeof v === 'number' && v > 0, { message: msg });
const requiredStr = (msg: string) => z.string().refine(v => v.trim().length > 0, { message: msg });
const requiredRange = (min: number, max: number, msg: string) =>
  z.union([z.number(), z.literal('')]).refine(v => typeof v === 'number' && v >= min && v <= max, { message: msg });

const digits = (v: string) => v.replace(/\D/g, '');
const toDate = (s: string) => (s ? new Date(s) : null);
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export const motherSchema = z
  .object({
    // Identity & clinical
    mother_name: requiredStr('Mother’s name is required (min 2 characters).').refine(v => v.trim().length >= 2, { message: 'Enter at least 2 characters.' }),
    adoption_date: requiredStr('Adoption date is required.'),
    mother_dob: requiredStr('Date of birth is required.'),
    mother_age: z.union([z.number(), z.literal('')]).optional(),   // derived from DOB, display-only
    weight: requiredRange(35, 200, 'Enter a weight between 35 and 200 kg.'),
    height: requiredRange(100, 230, 'Enter a height between 100 and 230 cm.'),
    lmp: requiredStr('LMP is required.'),
    edd_records: requiredStr('Expected delivery date (records) is required.'),
    mobile: z.string().refine(v => /^\d{10}$/.test(digits(v)), { message: 'Enter a valid 10-digit mobile number.' }),
    alternate_mobile: z.string().optional().refine(v => !v || /^\d{10}$/.test(digits(v)), { message: 'Alternate number must be 10 digits.' }),
    email: z.string().optional().refine(v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: 'Enter a valid email.' }),
    // Socio-demographic & location
    state_id: requiredId('Please select a state.'),
    district_id: requiredId('Please select a district.'),
    taluk_id: requiredId('Please select a taluk.'),
    village: requiredStr('Village is required.'),
    hwc_id: requiredId('Please select an HWC.'),
    phc_id: requiredId('PHC is required.'),
    education_id: requiredId('Please select an education level.'),
    education_field_id: z.union([z.number(), z.literal('')]).optional(),
    education_degree_id: z.union([z.number(), z.literal('')]).optional(),
    occupation: requiredStr('Please select an occupation.'),
    occupation_other: z.string().optional(),
    ration_card: requiredStr('Please select a ration card type.'),
    social_category: requiredStr('Please select a social category.'),
    // KAP
    nutrition_course: requiredStr('Please answer this question.'),
    nutrition_course_name: z.string().optional(),
    video_frequency: requiredStr('Please select one.'),
    source_ratings: z.record(z.string(), z.object({ trust: z.number().optional(), willingness: z.number().optional() })),
    implement_video: requiredStr('Please select one.'),
    confidence_video: requiredStr('Please select one.'),
    willingness_hcw: requiredStr('Please select one.'),
    information_seeking: requiredStr('Please select one.'),
    // Derived flags (drive conditional-required rules)
    showEducationField: z.boolean().optional(),
    showOccupationOther: z.boolean().optional(),
    showNutritionCourseName: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const today = new Date();
    const lmp = toDate(v.lmp);
    if (lmp) {
      if (daysBetween(lmp, today) > 0) ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'LMP cannot be in the future.' });
      else if (daysBetween(today, lmp) > 180) ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'LMP cannot be more than 180 days ago.' });
    }
    const dob = toDate(v.mother_dob || '');
    if (dob && daysBetween(dob, today) > 0) ctx.addIssue({ code: 'custom', path: ['mother_dob'], message: 'Date of birth cannot be in the future.' });
    if (typeof v.mother_age === 'number' && (v.mother_age < 10 || v.mother_age > 50))
      ctx.addIssue({ code: 'custom', path: ['mother_dob'], message: 'Date of birth implies an age outside 10–50 years.' });
    const adoption = toDate(v.adoption_date);
    if (adoption) {
      if (daysBetween(adoption, today) > 0) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'Adoption date cannot be in the future.' });
      if (dob && adoption < dob) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'Adoption date cannot be before the date of birth.' });
    }
    if (v.mobile && v.alternate_mobile && digits(v.mobile) === digits(v.alternate_mobile))
      ctx.addIssue({ code: 'custom', path: ['alternate_mobile'], message: 'Alternate mobile must differ from the primary.' });
    if (v.showEducationField) {
      if (!(typeof v.education_field_id === 'number' && v.education_field_id > 0))
        ctx.addIssue({ code: 'custom', path: ['education_field_id'], message: 'Please select a field.' });
      if (!(typeof v.education_degree_id === 'number' && v.education_degree_id > 0))
        ctx.addIssue({ code: 'custom', path: ['education_degree_id'], message: 'Please select a degree.' });
    }
    if (v.showOccupationOther && !v.occupation_other?.trim())
      ctx.addIssue({ code: 'custom', path: ['occupation_other'], message: 'Please specify the occupation.' });
    if (v.showNutritionCourseName && !v.nutrition_course_name?.trim())
      ctx.addIssue({ code: 'custom', path: ['nutrition_course_name'], message: 'Please specify the course.' });
    // Matrix: every source needs both a trust and a willingness rating.
    const incomplete = MATRIX_SOURCES.some(s => {
      const r = v.source_ratings?.[s.key];
      return !(r && typeof r.trust === 'number' && typeof r.willingness === 'number');
    });
    if (incomplete) ctx.addIssue({ code: 'custom', path: ['source_ratings'], message: 'Please rate trust and willingness for every source.' });
  });

export type MotherFormValues = z.input<typeof motherSchema>;

export const MR_STEP_FIELDS: readonly (readonly string[])[] = [
  ['mother_name', 'adoption_date', 'mother_dob', 'mother_age', 'weight', 'height', 'lmp', 'edd_records', 'mobile', 'alternate_mobile', 'email'],
  ['state_id', 'district_id', 'taluk_id', 'village', 'hwc_id', 'phc_id', 'education_id', 'education_field_id', 'education_degree_id', 'occupation', 'occupation_other', 'ration_card', 'social_category'],
  ['nutrition_course', 'nutrition_course_name', 'video_frequency', 'source_ratings', 'implement_video', 'confidence_video', 'willingness_hcw', 'information_seeking'],
];

export function validateMother(values: MotherFormValues): FieldErrors {
  return toFieldErrors(motherSchema.safeParse(values));
}

export function validateMotherStep(values: MotherFormValues, step: number): FieldErrors {
  return pickErrors(validateMother(values), MR_STEP_FIELDS[step] ?? []);
}
