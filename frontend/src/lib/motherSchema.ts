import { z } from 'zod';
import { toFieldErrors, pickErrors, type FieldErrors } from './validation';
import {
  HWC_OTHER, MATRIX_SOURCES, MAX_ADOPTION_AGE_DAYS, MAX_GESTATION_DAYS, MIN_GESTATION_DAYS,
} from './motherFields';

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
    edd_records: z.string().optional(),
    mobile: z.string().refine(v => /^\d{10}$/.test(digits(v)), { message: 'validation:common.phone10' }),
    alternate_mobile: z.string().optional().refine(v => !v || /^\d{10}$/.test(digits(v)), { message: 'validation:common.altPhone10' }),
    email: z.string().optional().refine(v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: 'validation:common.email' }),
    // Socio-demographic & location
    state_id: requiredId('validation:common.selectState'),
    district_id: requiredId('validation:common.selectDistrict'),
    taluk_id: requiredId('validation:common.selectTaluk'),
    village: requiredStr('validation:mother.villageRequired'),
    hwc_id: z.union([z.number(), z.literal('')]),   // a real id, or the HWC_OTHER sentinel — checked in superRefine
    hwc_other: z.string().optional(),
    phc_id: z.union([z.number(), z.literal('')]).optional(),   // required only for a real HWC — checked in superRefine
    education_id: requiredId('validation:mother.education'),
    education_field_id: z.union([z.number(), z.literal('')]).optional(),
    education_degree_id: z.union([z.number(), z.literal('')]).optional(),
    occupation: requiredStr('validation:mother.occupation'),
    occupation_other: z.string().optional(),
    ration_card: requiredStr('validation:mother.rationCard'),
    ration_card_other: z.string().optional(),
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
    isEdit: z.boolean().optional(),   // editing an existing record → skip registration-time freshness bounds
  })
  .superRefine((v, ctx) => {
    const today = new Date();
    const dob = toDate(v.mother_dob || '');
    const adoption = toDate(v.adoption_date);
    const lmp = toDate(v.lmp);
    if (lmp) {
      if (daysBetween(lmp, today) > 0) ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'validation:mother.lmpFuture' });
      else if (dob && lmp < dob) ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'validation:mother.lmpBeforeDob' });
      else if (adoption && lmp > adoption) ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'validation:mother.lmpAfterAdoption' });
      else if (adoption && daysBetween(adoption, lmp) > MAX_GESTATION_DAYS)
        ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'validation:mother.lmp180' });
      // A pregnancy under 12 weeks at the adoption date is not eligible for the
      // programme — judged at adoption, which is the moment the rule is about.
      else if (adoption && daysBetween(adoption, lmp) < MIN_GESTATION_DAYS)
        ctx.addIssue({ code: 'custom', path: ['lmp'], message: 'validation:mother.gestationMin12' });
    }
    if (dob && daysBetween(dob, today) > 0) ctx.addIssue({ code: 'custom', path: ['mother_dob'], message: 'validation:common.dobFuture' });
    if (typeof v.mother_age === 'number' && (v.mother_age < 10 || v.mother_age > 50))
      ctx.addIssue({ code: 'custom', path: ['mother_dob'], message: 'validation:mother.ageRange' });
    if (adoption) {
      if (daysBetween(adoption, today) > 0) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:common.adoptionFuture' });
      else if (!v.isEdit && daysBetween(today, adoption) > MAX_ADOPTION_AGE_DAYS)
        ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:mother.adoption14' });
      if (dob && adoption < dob) ctx.addIssue({ code: 'custom', path: ['adoption_date'], message: 'validation:common.adoptionBeforeDob' });
    }
    if (!(typeof v.hwc_id === 'number' && (v.hwc_id > 0 || v.hwc_id === HWC_OTHER)))
      ctx.addIssue({ code: 'custom', path: ['hwc_id'], message: 'validation:mother.hwc' });
    else if (v.hwc_id === HWC_OTHER) {
      if (!v.hwc_other?.trim()) ctx.addIssue({ code: 'custom', path: ['hwc_other'], message: 'validation:mother.hwcOther' });
    } else if (!(typeof v.phc_id === 'number' && v.phc_id > 0))
      ctx.addIssue({ code: 'custom', path: ['phc_id'], message: 'validation:mother.phc' });
    if (v.ration_card === 'Others' && !v.ration_card_other?.trim())
      ctx.addIssue({ code: 'custom', path: ['ration_card_other'], message: 'validation:mother.rationCardOther' });
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
  ['state_id', 'district_id', 'taluk_id', 'village', 'hwc_id', 'hwc_other', 'phc_id', 'education_id', 'education_field_id', 'education_degree_id', 'occupation', 'occupation_other', 'ration_card', 'ration_card_other', 'social_category'],
  ['nutrition_course', 'nutrition_course_name', 'video_frequency', 'source_ratings', 'implement_video', 'confidence_video', 'willingness_hcw', 'information_seeking'],
];

export function validateMother(values: MotherFormValues): FieldErrors {
  return toFieldErrors(motherSchema.safeParse(values));
}

export function validateMotherStep(values: MotherFormValues, step: number): FieldErrors {
  return pickErrors(validateMother(values), MR_STEP_FIELDS[step] ?? []);
}
