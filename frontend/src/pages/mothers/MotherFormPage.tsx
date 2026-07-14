import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import {
  Button, Card, DateInput, Field, Input, PageHeader, Radio, RatingGrid, SearchableSelect, SelectField, Stepper,
} from '../../components/ui';
import { useMotherMetadata } from '../../hooks/useMotherMetadata';
import { ageFromDob } from '../../lib/learnerFields';
import {
  OCCUPATIONS, RATION_CARDS, SOCIAL_CATEGORIES, VIDEO_FREQUENCY, LIKERT, MATRIX_SOURCES,
  eddFromLmp, gestationalAge,
} from '../../lib/motherFields';
import { validateMother, validateMotherStep, MR_STEP_FIELDS, type MotherFormValues } from '../../lib/motherSchema';
import type { FieldErrors } from '../../lib/validation';
import { createMother, type MotherPayload } from '../../api/mothers';

const STEPS = ['Identity & Clinical', 'Location & Background', 'Knowledge & Attitudes'];
const opts = (list: string[]) => list.map(o => ({ value: o, label: o }));

const ReadOnly: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <Field label={label}>
    <div className="rounded-lg border border-border-strong/60 bg-surface-sunken px-3.5 py-2.5 text-sm">
      {value ? value : <span className="text-ink-faint">{hint}</span>}
    </div>
  </Field>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-4 border-b-2 border-coral-100 pb-2 text-[13px] font-bold uppercase tracking-wider
                  text-primary dark:border-coral-950">{children}</div>
);

const MotherFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast, updateToast } = useToast();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Step 1 — identity & clinical
  const [motherName, setMotherName] = useState('');
  const [adoptionDate, setAdoptionDate] = useState('');
  const [motherDob, setMotherDob] = useState('');
  const [weight, setWeight] = useState<number | ''>('');
  const [height, setHeight] = useState<number | ''>('');
  const [lmp, setLmp] = useState('');
  const [eddRecords, setEddRecords] = useState('');
  const [mobile, setMobile] = useState('');
  const [alternateMobile, setAlternateMobile] = useState('');
  const [email, setEmail] = useState('');

  // Step 2 — location & background
  const [stateId, setStateId] = useState<number | ''>('');
  const [districtId, setDistrictId] = useState<number | ''>('');
  const [talukId, setTalukId] = useState<number | ''>('');
  const [village, setVillage] = useState('');
  const [hwcId, setHwcId] = useState<number | ''>('');
  const [educationId, setEducationId] = useState<number | ''>('');
  const [educationFieldId, setEducationFieldId] = useState<number | ''>('');
  const [educationDegreeId, setEducationDegreeId] = useState<number | ''>('');
  const [occupation, setOccupation] = useState('');
  const [occupationOther, setOccupationOther] = useState('');
  const [rationCard, setRationCard] = useState('');
  const [socialCategory, setSocialCategory] = useState('');

  // Step 3 — knowledge & attitudes
  const [nutritionCourse, setNutritionCourse] = useState('');   // 'Yes' | 'No'
  const [nutritionCourseName, setNutritionCourseName] = useState('');
  const [videoFrequency, setVideoFrequency] = useState('');
  const [ratings, setRatings] = useState<Record<string, Record<string, number>>>({});
  const [likert, setLikert] = useState<Record<string, string>>({});

  const meta = useMotherMetadata(
    { stateId, districtId, talukId, hwcId, educationFieldId },
    msg => showToast(msg, 'error'),
  );

  // Age is derived from DOB — display only, never an input (mirrors the learner form).
  const motherAge = ageFromDob(motherDob);

  const eddLmp = eddFromLmp(lmp);
  const gest = gestationalAge(lmp);
  const selectedEducation = meta.educationLevels.find(l => l.id === Number(educationId));
  const showEducationField = selectedEducation?.requires_field ?? false;
  const showOccupationOther = occupation === 'Other';
  const showNutritionCourseName = nutritionCourse === 'Yes';

  const clearError = (key: string) =>
    setErrors(e => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));

  // Cascade change handlers.
  const onState = (v: string) => { setStateId(v ? Number(v) : ''); setDistrictId(''); setTalukId(''); setHwcId(''); clearError('state_id'); };
  const onDistrict = (v: string) => { setDistrictId(v ? Number(v) : ''); setTalukId(''); setHwcId(''); clearError('district_id'); };
  const onTaluk = (v: string) => { setTalukId(v ? Number(v) : ''); setHwcId(''); clearError('taluk_id'); };
  const onHwc = (v: string) => { setHwcId(v ? Number(v) : ''); clearError('hwc_id'); };
  const onEducation = (v: string) => { setEducationId(v ? Number(v) : ''); setEducationFieldId(''); setEducationDegreeId(''); clearError('education_id'); };
  const onEducationField = (v: string) => { setEducationFieldId(v ? Number(v) : ''); setEducationDegreeId(''); clearError('education_field_id'); };

  const values: MotherFormValues = useMemo(() => ({
    mother_name: motherName, adoption_date: adoptionDate, mother_dob: motherDob, mother_age: motherAge,
    weight, height, lmp, edd_records: eddRecords, mobile, alternate_mobile: alternateMobile, email,
    state_id: stateId, district_id: districtId, taluk_id: talukId, village, hwc_id: hwcId,
    phc_id: meta.phc?.id ?? '', education_id: educationId, education_field_id: educationFieldId,
    education_degree_id: educationDegreeId, occupation, occupation_other: occupationOther,
    ration_card: rationCard, social_category: socialCategory, nutrition_course: nutritionCourse,
    nutrition_course_name: nutritionCourseName, video_frequency: videoFrequency, source_ratings: ratings,
    implement_video: likert.implement_video ?? '', confidence_video: likert.confidence_video ?? '',
    willingness_hcw: likert.willingness_hcw ?? '', information_seeking: likert.information_seeking ?? '',
    showEducationField, showOccupationOther, showNutritionCourseName,
  }), [motherName, adoptionDate, motherDob, motherAge, weight, height, lmp, eddRecords, mobile, alternateMobile,
    email, stateId, districtId, talukId, village, hwcId, meta.phc, educationId, educationFieldId, educationDegreeId,
    occupation, occupationOther, rationCard, socialCategory, nutritionCourse, nutritionCourseName, videoFrequency,
    ratings, likert, showEducationField, showOccupationOther, showNutritionCourseName]);

  const next = () => {
    const stepErrs = validateMotherStep(values, step);
    setErrors(stepErrs);
    if (!Object.keys(stepErrs).length) setStep(s => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { setErrors({}); setStep(s => Math.max(s - 1, 0)); };

  const buildPayload = (): MotherPayload => ({
    mother_name: motherName, adoption_date: adoptionDate || null, mother_dob: motherDob || null,
    mother_age: motherAge === '' ? null : Number(motherAge), weight: weight === '' ? null : Number(weight),
    height: height === '' ? null : Number(height), lmp: lmp || null, edd_records: eddRecords || null,
    mobile: mobile || null, alternate_mobile: alternateMobile || null, email: email || null,
    state_id: stateId === '' ? null : Number(stateId), district_id: districtId === '' ? null : Number(districtId),
    taluk_id: talukId === '' ? null : Number(talukId), village: village || null,
    hwc_id: hwcId === '' ? null : Number(hwcId), phc_id: meta.phc?.id ?? null,
    education_id: educationId === '' ? null : Number(educationId),
    education_field_id: showEducationField && educationFieldId !== '' ? Number(educationFieldId) : null,
    education_degree_id: showEducationField && educationDegreeId !== '' ? Number(educationDegreeId) : null,
    occupation: occupation || null, occupation_other: showOccupationOther ? occupationOther : null,
    ration_card: rationCard || null, social_category: socialCategory || null,
    nutrition_course: nutritionCourse === '' ? null : nutritionCourse === 'Yes',
    nutrition_course_name: showNutritionCourseName ? nutritionCourseName : null,
    video_frequency: videoFrequency || null,
    implement_video: likert.implement_video ?? null, confidence_video: likert.confidence_video ?? null,
    willingness_hcw: likert.willingness_hcw ?? null, information_seeking: likert.information_seeking ?? null,
    source_ratings: MATRIX_SOURCES.map(s => ({
      source: s.key, trust: ratings[s.key]?.trust ?? null, willingness: ratings[s.key]?.willingness ?? null,
    })),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const allErrs = validateMother(values);
    if (Object.keys(allErrs).length) {
      setErrors(allErrs);
      const firstStep = MR_STEP_FIELDS.findIndex(keys => keys.some(k => allErrs[k]));
      if (firstStep >= 0) setStep(firstStep);
      return;
    }
    setLoading(true);
    const toastId = showToast('Registering mother...', 'loading');
    try {
      const created = await createMother(buildPayload());
      updateToast(toastId, `Registered ${created.mother_name} (${created.mother_uid}).`, 'success');
      navigate('/mothers');
    } catch {
      updateToast(toastId, 'Failed to register. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const isLast = step === STEPS.length - 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Register a Mother" description="Enrol a pregnant mother into the program." />
      <Card className="p-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-7" noValidate>
          <Stepper steps={STEPS} current={step} />

          {step === 0 && (
            <div>
              <SectionTitle>Identity &amp; Clinical</SectionTitle>
              <div className="flex flex-col gap-4">
                <Field label="Mother's name" error={errors.mother_name}>
                  <Input value={motherName} error={!!errors.mother_name}
                    onChange={e => { setMotherName(e.target.value); clearError('mother_name'); }} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Date of adoption" error={errors.adoption_date}>
                    <DateInput value={adoptionDate} max={new Date().toISOString().slice(0, 10)}
                      error={!!errors.adoption_date} onChange={v => { setAdoptionDate(v); clearError('adoption_date'); }} />
                  </Field>
                  <Field label="Date of birth" error={errors.mother_dob}>
                    <DateInput value={motherDob} max={new Date().toISOString().slice(0, 10)}
                      error={!!errors.mother_dob} onChange={v => { setMotherDob(v); clearError('mother_dob'); }} />
                  </Field>
                  <ReadOnly label="Age (auto from DOB)" value={motherAge === '' ? '' : `${motherAge} years`} hint="Set DOB to calculate" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Weight at adoption (kg)" error={errors.weight}>
                    <Input type="number" step={0.1} min={35} max={200} value={weight} error={!!errors.weight}
                      onChange={e => { setWeight(e.target.value ? Number(e.target.value) : ''); clearError('weight'); }} />
                  </Field>
                  <Field label="Height at adoption (cm)" error={errors.height}>
                    <Input type="number" step={0.1} min={100} max={230} value={height} error={!!errors.height}
                      onChange={e => { setHeight(e.target.value ? Number(e.target.value) : ''); clearError('height'); }} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Last menstrual period (LMP)" error={errors.lmp}>
                    <DateInput value={lmp} max={new Date().toISOString().slice(0, 10)} error={!!errors.lmp}
                      onChange={v => { setLmp(v); clearError('lmp'); }} />
                  </Field>
                  <ReadOnly label="EDD as per LMP (auto)" value={eddLmp} hint="Set LMP to calculate" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ReadOnly label="Gestational age" value={gest ? `${gest.weeks} weeks · ${gest.months} months` : ''} hint="Set LMP to calculate" />
                  <Field label="EDD as per latest records" error={errors.edd_records}>
                    <DateInput value={eddRecords} error={!!errors.edd_records}
                      onChange={v => { setEddRecords(v); clearError('edd_records'); }} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Mobile number" error={errors.mobile}>
                    <Input type="tel" inputMode="numeric" placeholder="10-digit" value={mobile} error={!!errors.mobile}
                      onChange={e => { setMobile(e.target.value); clearError('mobile'); }} />
                  </Field>
                  <Field label="Alternate mobile (optional)" error={errors.alternate_mobile}>
                    <Input type="tel" inputMode="numeric" value={alternateMobile} error={!!errors.alternate_mobile}
                      onChange={e => { setAlternateMobile(e.target.value); clearError('alternate_mobile'); }} />
                  </Field>
                  <Field label="Email (optional)" error={errors.email}>
                    <Input type="email" value={email} error={!!errors.email}
                      onChange={e => { setEmail(e.target.value); clearError('email'); }} />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <SectionTitle>Location &amp; Background</SectionTitle>
              <div className="flex flex-col gap-4">
                <SelectField label="State" value={stateId} onChange={onState} error={errors.state_id}
                  placeholder="Select state" options={meta.states.map(s => ({ value: s.id, label: s.name }))} />
                <SelectField label="District" value={districtId} onChange={onDistrict} error={errors.district_id}
                  placeholder="Select district" disabled={!stateId}
                  options={meta.districts.map(d => ({ value: d.id, label: d.name }))} />
                <SelectField label="Taluk" value={talukId} onChange={onTaluk} error={errors.taluk_id}
                  placeholder="Select taluk" disabled={!districtId}
                  options={meta.taluks.map(t => ({ value: t.id, label: t.name }))} />
                <Field label="Village" error={errors.village}>
                  <Input value={village} error={!!errors.village}
                    onChange={e => { setVillage(e.target.value); clearError('village'); }} />
                </Field>
                <SearchableSelect label="Health & Wellness Centre (HWC)" value={hwcId} onChange={onHwc}
                  error={errors.hwc_id} placeholder="Search HWC" disabled={!talukId}
                  options={meta.hwcs.map(h => ({ value: h.id, label: h.name }))} />
                <ReadOnly label="Primary Health Centre (auto)" value={meta.phc?.name ?? ''} hint="Auto-fills from the selected HWC" />
                <SelectField label="Highest education" value={educationId} onChange={onEducation} error={errors.education_id}
                  placeholder="Select education level" options={meta.educationLevels.map(l => ({ value: l.id, label: l.name }))} />
                {showEducationField && (
                  <>
                    <SelectField label="Field of study" value={educationFieldId} onChange={onEducationField}
                      error={errors.education_field_id} placeholder="Select field"
                      options={meta.educationFields.map(f => ({ value: f.id, label: f.name }))} />
                    <SearchableSelect label="Degree / diploma" value={educationDegreeId}
                      onChange={v => { setEducationDegreeId(v ? Number(v) : ''); clearError('education_degree_id'); }}
                      error={errors.education_degree_id} placeholder="Search degree" disabled={!educationFieldId}
                      options={meta.educationDegrees.map(d => ({ value: d.id, label: d.name }))} />
                  </>
                )}
                <SelectField label="Occupation" value={occupation}
                  onChange={v => { setOccupation(v); clearError('occupation'); }} error={errors.occupation}
                  placeholder="Select occupation" options={opts(OCCUPATIONS)} />
                {showOccupationOther && (
                  <Field label="Specify occupation" error={errors.occupation_other}>
                    <Input value={occupationOther} error={!!errors.occupation_other}
                      onChange={e => { setOccupationOther(e.target.value); clearError('occupation_other'); }} />
                  </Field>
                )}
                <SelectField label="Ration card type" value={rationCard}
                  onChange={v => { setRationCard(v); clearError('ration_card'); }} error={errors.ration_card}
                  placeholder="Select ration card" options={opts(RATION_CARDS)} />
                <SelectField label="Social category" value={socialCategory}
                  onChange={v => { setSocialCategory(v); clearError('social_category'); }} error={errors.social_category}
                  placeholder="Select social category" options={opts(SOCIAL_CATEGORIES)} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <SectionTitle>Knowledge &amp; Attitudes</SectionTitle>
              <div className="flex flex-col gap-4">
                <Field label="Completed any certificate course/training on nutrition, pregnancy or child care?" error={errors.nutrition_course}>
                  <div className="mt-1 flex gap-4">
                    {['Yes', 'No'].map(o => (
                      <Radio key={o} name="nutrition_course" value={o} checked={nutritionCourse === o}
                        onChange={e => { setNutritionCourse(e.target.value); clearError('nutrition_course'); }} label={o} />
                    ))}
                  </div>
                </Field>
                {showNutritionCourseName && (
                  <Field label="Specify the course" error={errors.nutrition_course_name}>
                    <Input value={nutritionCourseName} error={!!errors.nutrition_course_name}
                      onChange={e => { setNutritionCourseName(e.target.value); clearError('nutrition_course_name'); }} />
                  </Field>
                )}
                <SelectField label="How often do you watch health-related videos on social media?" value={videoFrequency}
                  onChange={v => { setVideoFrequency(v); clearError('video_frequency'); }} error={errors.video_frequency}
                  placeholder="Select frequency" options={opts(VIDEO_FREQUENCY)} />

                <Field label="For each source, rate how much you trust it and how willing you are to follow its advice" error={errors.source_ratings}>
                  <RatingGrid rowHeader="Source" rows={MATRIX_SOURCES}
                    columns={[{ key: 'trust', label: 'Trust (1–5)' }, { key: 'willingness', label: 'Willingness (1–5)' }]}
                    value={ratings}
                    onChange={(row, col, n) => {
                      setRatings(prev => ({ ...prev, [row]: { ...prev[row], [col]: n } }));
                      clearError('source_ratings');
                    }} />
                </Field>

                {LIKERT.map(q => (
                  <SelectField key={q.key} label={q.label} value={likert[q.key] ?? ''}
                    onChange={v => { setLikert(prev => ({ ...prev, [q.key]: v })); clearError(q.key); }}
                    error={errors[q.key]} placeholder="Select one" options={opts(q.options)} />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-5">
            <Button type="button" variant="ghost" onClick={() => navigate('/mothers')} disabled={loading}>Cancel</Button>
            {step > 0 && <Button type="button" variant="secondary" onClick={back} disabled={loading}>Back</Button>}
            {!isLast ? (
              <Button type="button" onClick={next} className="ml-auto">Continue</Button>
            ) : (
              <Button type="submit" size="lg" loading={loading} className="ml-auto">
                {loading ? 'Registering...' : 'Register Mother ✓'}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
};

export default MotherFormPage;
