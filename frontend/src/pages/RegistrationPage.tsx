import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import { Button, ComboBox, Field, Input, Radio, SelectField, Stepper } from '../components/ui';
import { useLearnerMetadata } from '../hooks/useLearnerMetadata';
import { GENDERS, MARITAL, INTERNET, TRAINING_RECENCY, TRAININGS, ageFromDob } from '../lib/learnerFields';
import { validateLearner, validateLearnerStep, LR_STEP_FIELDS, type LearnerFormValues } from '../lib/learnerSchema';
import type { FieldErrors } from '../lib/validation';

const STEPS = ['Personal', 'Work & Location', 'Education', 'Training'];

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-4 border-b-2 border-coral-100 pb-2 text-[13px] font-bold uppercase
                  tracking-wider text-primary dark:border-coral-950">
    {children}
  </div>
);

const RegistrationPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});

  // ── Personal ──
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [phone, setPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [hasChildren, setHasChildren] = useState('');           // 'Yes' | 'No'
  const [numberChildren, setNumberChildren] = useState<number | ''>('');

  // ── Work & Location ──
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [departmentOther, setDepartmentOther] = useState('');
  const [designationId, setDesignationId] = useState<number | ''>('');
  const [facilityTypeId, setFacilityTypeId] = useState<number | ''>('');
  const [stateId, setStateId] = useState<number | ''>('');
  const [districtId, setDistrictId] = useState<number | ''>('');
  const [blockId, setBlockId] = useState<number | ''>('');
  const [villageId, setVillageId] = useState<number | ''>('');
  const [villageName, setVillageName] = useState('');
  const [facilityId, setFacilityId] = useState<number | ''>('');
  const [residenceDistance, setResidenceDistance] = useState<number | ''>('');

  // ── Education & experience ──
  const [qualificationId, setQualificationId] = useState<number | ''>('');
  const [qualificationOther, setQualificationOther] = useState('');
  const [yearsService, setYearsService] = useState<number | ''>('');
  const [yearsDesignation, setYearsDesignation] = useState<number | ''>('');
  const [yearsFacility, setYearsFacility] = useState<number | ''>('');
  const [internetWorkplace, setInternetWorkplace] = useState('');

  // ── Training recency (keyed) ──
  const [trainings, setTrainings] = useState<Record<string, string>>({});

  const { updateProfile } = useAuth();
  const { showToast, updateToast } = useToast();
  const navigate = useNavigate();

  const meta = useLearnerMetadata(
    { departmentId, designationId, stateId, districtId, blockId },
    msg => showToast(msg, 'error'),
  );

  const selectedDept = meta.departments.find(d => d.id === Number(departmentId));
  const isOtherDept = selectedDept?.code === 'OTHER';
  const selectedQual = meta.qualifications.find(q => q.id === Number(qualificationId));
  const showQualOther = selectedQual?.has_semi_open_input ?? false;

  // Clears one field's error the moment the user edits it.
  const clearError = (key: string) =>
    setErrors(e => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));

  // ── Cascade change handlers (set value + reset dependents + clear own error) ──
  const onDepartment = (v: string) => {
    setDepartmentId(v ? Number(v) : ''); setDesignationId(''); setFacilityTypeId(''); setQualificationId('');
    clearError('departmentId');
  };
  const onDesignation = (v: string) => { setDesignationId(v ? Number(v) : ''); setFacilityTypeId(''); clearError('designationId'); };
  const onState = (v: string) => {
    setStateId(v ? Number(v) : ''); setDistrictId(''); setBlockId(''); setVillageId(''); setVillageName(''); setFacilityId('');
    clearError('stateId');
  };
  const onDistrict = (v: string) => { setDistrictId(v ? Number(v) : ''); setBlockId(''); setVillageId(''); setVillageName(''); setFacilityId(''); clearError('districtId'); };
  const onBlock = (v: string) => { setBlockId(v ? Number(v) : ''); setVillageId(''); setVillageName(''); setFacilityId(''); clearError('blockId'); };

  // Village combobox: pick a known village (sets the id) or type a custom name (clears it).
  const onVillagePick = (o: { value: number | string; label: string }) => {
    setVillageId(Number(o.value)); setVillageName(o.label); clearError('villageName');
  };
  const onVillageType = (text: string) => { setVillageName(text); setVillageId(''); clearError('villageName'); };

  // Age is derived from DOB — display only, never an input.
  const age = ageFromDob(dob);

  const values: LearnerFormValues = {
    dob, age, gender, phone, alternatePhone, maritalStatus, hasChildren, numberChildren,
    departmentId, departmentOther, designationId, facilityTypeId, stateId, districtId, blockId,
    villageId, villageName, facilityId, residenceDistance, qualificationId, qualificationOther,
    yearsService, yearsDesignation, yearsFacility, internetWorkplace, trainings,
    isOtherDept, showQualificationOther: showQualOther,
  };

  const next = () => {
    const stepErrs = validateLearnerStep(values, step);
    setErrors(stepErrs);
    if (Object.keys(stepErrs).length) return;
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { setErrors({}); setStep(s => Math.max(s - 1, 0)); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const allErrs = validateLearner(values);
    if (Object.keys(allErrs).length) {
      setErrors(allErrs);
      const firstStep = LR_STEP_FIELDS.findIndex(keys => keys.some(k => allErrs[k]));
      if (firstStep >= 0) setStep(firstStep);
      return;
    }

    setLoading(true);
    const toastId = showToast('Submitting your registration...', 'loading');
    try {
      const designationName = meta.designations.find(d => d.id === Number(designationId))?.name;
      const facilityTypeName = meta.facilityTypes.find(f => f.id === Number(facilityTypeId))?.name;
      const districtName = meta.districts.find(d => d.id === Number(districtId))?.name;
      const facilityName = meta.facilities.find(f => f.id === Number(facilityId))?.name;

      await updateProfile({
        date_of_birth: dob,
        age: age === '' ? undefined : Number(age),
        gender,
        phone,
        alternate_phone: alternatePhone || undefined,
        marital_status: maritalStatus,
        has_children: hasChildren === 'Yes',
        number_children: hasChildren === 'Yes' ? Number(numberChildren) : undefined,
        // professional axis: FK + legacy string (role gates profile-complete)
        department_id: Number(departmentId),
        department: selectedDept?.name,
        department_other: isOtherDept ? departmentOther : undefined,
        designation_id: Number(designationId),
        role: designationName,
        facility_type_id: Number(facilityTypeId),
        work_center_type: facilityTypeName,
        // geography: FK + legacy string
        state_id: Number(stateId),
        district_id: Number(districtId),
        block_id: Number(blockId),
        village_id: villageId ? Number(villageId) : null,
        village_name: villageId ? null : (villageName || null),
        facility_id: Number(facilityId),
        district: districtName,
        work_center_name: facilityName,
        residence_distance_km: Number(residenceDistance),
        // education & experience
        qualification_id: Number(qualificationId),
        qualification_other_detail: showQualOther ? qualificationOther : undefined,
        years_service: Number(yearsService),
        years_designation: Number(yearsDesignation),
        years_facility: Number(yearsFacility),
        internet_workplace: internetWorkplace,
        // training recency
        nutrition_training: trainings.nutrition_training,
        pregnancy_nutrition_training: trainings.pregnancy_nutrition_training,
        breastfeeding_training: trainings.breastfeeding_training,
        complementary_feeding_training: trainings.complementary_feeding_training,
        growth_monitoring_training: trainings.growth_monitoring_training,
      });
      updateToast(toastId, 'Registration completed! Welcome to NurtureHUB.', 'success');
      navigate('/dashboard');
    } catch {
      updateToast(toastId, 'Failed to save registration. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const isLastStep = step === STEPS.length - 1;

  return (
    <AuthLayout
      title="Complete Registration"
      subtitle="Fill in your details below to customize your learning and assessment dashboard."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-7" noValidate>
        <Stepper steps={STEPS} current={step} className="mb-1" />

        {/* ── Step 1: Personal ── */}
        {step === 0 && (
          <div>
            <SectionTitle>Personal Details</SectionTitle>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Date of Birth" htmlFor="dob-input" error={errors.dob}>
                  <Input id="dob-input" type="date" value={dob} max={new Date().toISOString().slice(0, 10)}
                    error={!!errors.dob} onChange={e => { setDob(e.target.value); clearError('dob'); }} />
                </Field>
                <Field label="Age (Years)">
                  <div className="rounded-lg border border-border-strong/60 bg-surface-sunken px-3.5 py-2.5 text-sm">
                    {age === '' ? <span className="text-ink-faint">Calculated from date of birth</span> : `${age} years`}
                  </div>
                </Field>
              </div>

              <Field label="Gender" error={errors.gender}>
                <div className="mt-1 flex flex-wrap gap-4">
                  {GENDERS.map(o => (
                    <Radio key={o} name="gender" value={o} checked={gender === o}
                      onChange={e => { setGender(e.target.value); clearError('gender'); }} label={o} />
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Mobile Number" htmlFor="phone-input" error={errors.phone}>
                  <Input id="phone-input" type="tel" inputMode="numeric" placeholder="10-digit mobile number"
                    value={phone} error={!!errors.phone}
                    onChange={e => { setPhone(e.target.value); clearError('phone'); }} />
                </Field>
                <Field label="Alternate Number (Optional)" htmlFor="alt-phone-input" error={errors.alternatePhone}>
                  <Input id="alt-phone-input" type="tel" inputMode="numeric" placeholder="Optional"
                    value={alternatePhone} error={!!errors.alternatePhone}
                    onChange={e => { setAlternatePhone(e.target.value); clearError('alternatePhone'); }} />
                </Field>
              </div>

              <SelectField label="Marital Status" value={maritalStatus} error={errors.maritalStatus}
                onChange={v => { setMaritalStatus(v); clearError('maritalStatus'); }}
                placeholder="Select marital status" options={MARITAL.map(m => ({ value: m, label: m }))} />

              <Field label="Do you have any children?" error={errors.hasChildren}>
                <div className="mt-1 flex gap-4">
                  {['Yes', 'No'].map(o => (
                    <Radio key={o} name="has_children" value={o} checked={hasChildren === o}
                      onChange={e => { setHasChildren(e.target.value); clearError('hasChildren'); }} label={o} />
                  ))}
                </div>
              </Field>

              {hasChildren === 'Yes' && (
                <Field label="Number of children" htmlFor="num-children" error={errors.numberChildren}>
                  <Input id="num-children" type="number" min={0} placeholder="e.g. 2" value={numberChildren}
                    error={!!errors.numberChildren}
                    onChange={e => { setNumberChildren(e.target.value ? Number(e.target.value) : ''); clearError('numberChildren'); }} />
                </Field>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Work & Location ── */}
        {step === 1 && (
          <div>
            <SectionTitle>Work &amp; Location</SectionTitle>
            <div className="flex flex-col gap-4">
              <SelectField label="Department" value={departmentId} onChange={onDepartment} error={errors.departmentId}
                placeholder="Select department" options={meta.departments.map(d => ({ value: d.id, label: d.name }))} />

              {isOtherDept && (
                <Field label="Specify department" htmlFor="dept-other" error={errors.departmentOther}>
                  <Input id="dept-other" type="text" placeholder="Enter department" error={!!errors.departmentOther}
                    value={departmentOther} onChange={e => { setDepartmentOther(e.target.value); clearError('departmentOther'); }} required />
                </Field>
              )}

              <SelectField label="Designation" value={designationId} onChange={onDesignation} error={errors.designationId}
                placeholder="Select designation" disabled={!departmentId}
                options={meta.designations.map(d => ({ value: d.id, label: d.name }))} />

              <SelectField label="Facility Type" value={facilityTypeId} error={errors.facilityTypeId}
                onChange={v => { setFacilityTypeId(v ? Number(v) : ''); clearError('facilityTypeId'); }}
                placeholder="Select facility type" disabled={!designationId}
                options={meta.facilityTypes.map(f => ({ value: f.id, label: f.name }))} />

              <SelectField label="State" value={stateId} onChange={onState} error={errors.stateId}
                placeholder="Select state" options={meta.states.map(s => ({ value: s.id, label: s.name }))} />

              <SelectField label="District" value={districtId} onChange={onDistrict} error={errors.districtId}
                placeholder="Select district" disabled={!stateId}
                options={meta.districts.map(d => ({ value: d.id, label: d.name }))} />

              <SelectField label="Taluk / Block" value={blockId} onChange={onBlock} error={errors.blockId}
                placeholder="Select taluk" disabled={!districtId}
                options={meta.blocks.map(b => ({ value: b.id, label: b.name }))} />

              <ComboBox label="Village" value={villageName} error={errors.villageName}
                onValueChange={onVillageType} onPick={onVillagePick}
                placeholder="Search or type your village" disabled={!blockId}
                options={meta.villages.map(v => ({ value: v.id, label: v.name }))} />

              <SelectField label="Facility Name" value={facilityId} error={errors.facilityId}
                onChange={v => { setFacilityId(v ? Number(v) : ''); clearError('facilityId'); }}
                placeholder="Select facility" disabled={!blockId}
                options={meta.facilities.map(f => ({ value: f.id, label: `${f.name} (${f.facility_type})` }))} />

              <Field label="Distance from residence to workplace (km)" htmlFor="residence-distance" error={errors.residenceDistance}>
                <Input id="residence-distance" type="number" min={0} max={100} step={0.1} placeholder="e.g. 5.5"
                  value={residenceDistance} error={!!errors.residenceDistance}
                  onChange={e => { setResidenceDistance(e.target.value ? Number(e.target.value) : ''); clearError('residenceDistance'); }} />
              </Field>
            </div>
          </div>
        )}

        {/* ── Step 3: Education & Experience ── */}
        {step === 2 && (
          <div>
            <SectionTitle>Education &amp; Experience</SectionTitle>
            <div className="flex flex-col gap-4">
              <SelectField label="Highest Educational Qualification" value={qualificationId} error={errors.qualificationId}
                onChange={v => { setQualificationId(v ? Number(v) : ''); clearError('qualificationId'); }}
                placeholder={departmentId ? 'Select qualification' : 'Select a department first'}
                disabled={!departmentId}
                options={meta.qualifications.map(q => ({ value: q.id, label: q.qualification_name }))} />

              {showQualOther && (
                <Field label="Please specify qualification" htmlFor="qual-other" error={errors.qualificationOther}>
                  <Input id="qual-other" type="text" placeholder="Enter details" error={!!errors.qualificationOther}
                    value={qualificationOther} onChange={e => { setQualificationOther(e.target.value); clearError('qualificationOther'); }} required />
                </Field>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Total years of service" htmlFor="years-service" error={errors.yearsService}>
                  <Input id="years-service" type="number" min={0} max={50} step={0.1} placeholder="0–50"
                    value={yearsService} error={!!errors.yearsService}
                    onChange={e => { setYearsService(e.target.value ? Number(e.target.value) : ''); clearError('yearsService'); }} />
                </Field>
                <Field label="Years in current designation" htmlFor="years-designation" error={errors.yearsDesignation}>
                  <Input id="years-designation" type="number" min={0} max={50} step={0.1} placeholder="years"
                    value={yearsDesignation} error={!!errors.yearsDesignation}
                    onChange={e => { setYearsDesignation(e.target.value ? Number(e.target.value) : ''); clearError('yearsDesignation'); }} />
                </Field>
                <Field label="Years at current facility" htmlFor="years-facility" error={errors.yearsFacility}>
                  <Input id="years-facility" type="number" min={0} max={50} step={0.1} placeholder="years"
                    value={yearsFacility} error={!!errors.yearsFacility}
                    onChange={e => { setYearsFacility(e.target.value ? Number(e.target.value) : ''); clearError('yearsFacility'); }} />
                </Field>
              </div>

              <SelectField label="Is internet connectivity adequate in your work area?" value={internetWorkplace}
                error={errors.internetWorkplace}
                onChange={v => { setInternetWorkplace(v); clearError('internetWorkplace'); }} placeholder="Select one"
                options={INTERNET.map(i => ({ value: i, label: i }))} />
            </div>
          </div>
        )}

        {/* ── Step 4: Training history ── */}
        {step === 3 && (
          <div>
            <SectionTitle>Training History</SectionTitle>
            <div className="flex flex-col gap-4">
              {TRAININGS.map(t => (
                <SelectField key={t.key} label={t.label} value={trainings[t.key] ?? ''}
                  error={errors[`trainings.${t.key}`]}
                  onChange={v => { setTrainings(prev => ({ ...prev, [t.key]: v })); clearError(`trainings.${t.key}`); }}
                  placeholder="Select one" options={TRAINING_RECENCY.map(r => ({ value: r, label: r }))} />
              ))}
            </div>
          </div>
        )}

        {/* ── Navigation ── */}
        <div className="flex items-center gap-3 border-t border-border pt-5">
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={back} disabled={loading}>
              Back
            </Button>
          )}
          {!isLastStep ? (
            <Button type="button" onClick={next} fullWidth>
              Continue
            </Button>
          ) : (
            <Button type="submit" size="lg" fullWidth loading={loading}>
              {loading ? 'Submitting...' : 'Complete Registration ✓'}
            </Button>
          )}
        </div>
      </form>
    </AuthLayout>
  );
};

export default RegistrationPage;
