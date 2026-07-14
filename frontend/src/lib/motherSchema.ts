import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';
import { MATRIX_SOURCES } from './motherFields';

// `msg` values are i18n keys (validation:*) resolved in toFieldErrors at validation time.
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
    mother_name: requiredStr('validation:mother.nameRequired').refine(v => v.trim().length >= 2, { message: 'validation:common.min2Chars' }),
    adoption_date: requiredStr('validation:mother.adoptionRequired'),
    mother_dob: requiredStr('validation:common.dobRequired'),
    mother_age: z.union([z.number(), z.literal('')]).optional(),   // derived from DOB, display-only
    weight: requiredRange(35, 200, 'validation:mother.weight'),
    height: requiredRange(100, 230, 'validation:mother.height'),
    lmp: requiredStr('validation:mother.lmpRequired'),
    edd_records: requiredStr('validation:mother.eddRequired'),
    mobile: z.string().refine(v => /^\d{10}$/.test(digits(v)), { message: 'validation:common.phone10' }),
    alternate_mobile: z.string().optional().refine(v => !v || /^\d{10}$/.test(digits(v)), { message: 'validation:common.altPhone10' }),
    email: z.string().optional().refine(v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: 'validation:common.email' }),
    // Socio-demographic & location
    state_id: requiredId('validation:common.selectState'),
    district_id: requiredId('validation:common.selectDistrict'),
    taluk_id: requiredId('validation:common.selectTaluk'),
    village: requiredStr('validation:mother.villageRequired'),
    hwc_id: requiredId('validation:mother.hwc'),
    phc_id: requiredId('validation:mother.phc'),
    education_id: requiredId('validation:mother.education'),
    education_field_id: z.union([z.number(), z.literal('')]).optional(),
    education_degree_id: z.union([z.number(), z.literal('')]).optional(),
    occupation: requiredStr('validation:mother.occupation'),
    occupation_other: z.string().optional(),
    ration_card: requiredStr('validation:mother.rationCard'),
    social_category: requiredStr('validation:mother.socialCategory'),
    // KAP
    nutrition_course: requiredStr('validation:common.answerQuestion'),
    nutrition_course_name: z.string().optional(),
    video_frequency: requiredStr('validation:common.selectOne'),
    source_ratings: z.record(z.string(), z.object({ trust: z.number().optional(), willingness: z.number().optional() })),
    implement_video: requiredStr('validation:common.selectOne'),
    confidence_video: requiredStr('validation:common.selectOne'),
    willingness_hcw: requiredStr('validation:common.selectOne'),
    information_seeking: requiredStr('validation:common.selectOne'),
    // Derived flags (drive conditional-required rules)
    showEducationField: z.boolean().optional(),
    showOccupationOther: z.boolean().optional(),
    showNutritionCourseName: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const today = new Date();
    const lmp = toDate(v.lmp);
    if (lmp) {
      if (daysBetween(lmp, today) > 0) ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'validation:mother.lmpFuture' });
      else if (daysBetween(today, lmp) > 180) ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'validation:mother.lmp180' });
    }
    const dob = toDate(v.mother_dob || '');
    if (dob && daysBetween(dob, today) > 0) ctx.addIssue({ code: 'custom', path: ['mother_dob'], message: 'validation:common.dobFuture' });
    if (typeof v.mother_age === 'number' && (v.mother_age < 10 || v.mother_age > 50))
      ctx.addIssue({ code: 'custom', path: ['mother_dob'], message: 'validation:mother.ageRange' });
    const adoption = toDate(v.adoption_date);
    if (adoption) {
      if (daysBetween(adoption, today) > 0) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:common.adoptionFuture' });
      if (dob && adoption < dob) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:common.adoptionBeforeDob' });
    }
    if (v.mobile && v.alternate_mobile && digits(v.mobile) === digits(v.alternate_mobile))
      ctx.addIssue({ code: 'custom', path: ['alternate_mobile'], message: 'validation:mother.altDiffers' });
    if (v.showEducationField) {
      if (!(typeof v.education_field_id === 'number' && v.education_field_id > 0))
        ctx.addIssue({ code: 'custom', path: ['education_field_id'], message: 'validation:mother.field' });
      if (!(typeof v.education_degree_id === 'number' && v.education_degree_id > 0))
        ctx.addIssue({ code: 'custom', path: ['education_degree_id'], message: 'validation:mother.degree' });
    }
    if (v.showOccupationOther && !v.occupation_other?.trim())
      ctx.addIssue({ code: 'custom', path: ['occupation_other'], message: 'validation:mother.occupationOther' });
    if (v.showNutritionCourseName && !v.nutrition_course_name?.trim())
      ctx.addIssue({ code: 'custom', path: ['nutrition_course_name'], message: 'validation:mother.courseName' });
    // Matrix: every source needs both a trust and a willingness rating.
    const incomplete = MATRIX_SOURCES.some(s => {
      const r = v.source_ratings?.[s.key];
      return !(r && typeof r.trust === 'number' && typeof r.willingness === 'number');
    });
    if (incomplete) ctx.addIssue({ code: 'custom', path: ['source_ratings'], message: 'validation:mother.ratings' });
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
