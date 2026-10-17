import React, { useEffect, useState } from 'react';
import { Lock, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import { Button, ComboBox, DateInput, Field, Input, Radio, SelectField, Stepper } from '../components/ui';
import { useLearnerMetadata } from '../hooks/useLearnerMetadata';
import client from '../api/client';
import { clearJoinProject, getRegistrationScope, joinProjectSlug, type RegistrationScope } from '../api/registration';
import {
  TRAINING_KEYS, ageFromDob, maxDobForAge, blockLabel, NEVER_MARRIED,
  genderOptions, maritalOptions, internetOptions, recencyOptions,
} from '../lib/learnerFields';
import { validateLearner, validateLearnerStep, LR_STEP_FIELDS, type LearnerFormValues } from '../lib/learnerSchema';
import type { FieldErrors } from '../lib/validation';

const STEP_KEYS = ['personal', 'work', 'education', 'training'] as const;

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-4 border-b-2 border-coral-100 pb-2 text-[13px] font-bold uppercase
                  tracking-wider text-primary-ink dark:border-coral-950">
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
  const [designationOther, setDesignationOther] = useState('');
  const [facilityTypeId, setFacilityTypeId] = useState<number | ''>('');
  const [facilityTypeOther, setFacilityTypeOther] = useState('');
  const [stateId, setStateId] = useState<number | ''>('');
  const [districtId, setDistrictId] = useState<number | ''>('');
  const [blockId, setBlockId] = useState<number | ''>('');
  const [villageId, setVillageId] = useState<number | ''>('');
  const [villageName, setVillageName] = useState('');
  const [gpId, setGpId] = useState<number | ''>('');
  const [gpName, setGpName] = useState('');
  const [facilityId, setFacilityId] = useState<number | ''>('');
  const [facilityName, setFacilityName] = useState('');
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
  // ── Email, last and optional (review of 17 Oct 2026) ──
  const [contactEmail, setContactEmail] = useState('');

  const { t } = useTranslation('learner');
  const { updateProfile, logout, user } = useAuth();
  const { showToast, updateToast } = useToast();
  const navigate = useNavigate();

  const steps = STEP_KEYS.map(k => t(`registration.steps.${k}`));

  // Registration by project (review of 17 Oct 2026): through a project's
  // link the state and district come filled in and locked; otherwise only
  // the places open for registration are offered.
  const joining = joinProjectSlug();
  const [scope, setScope] = useState<RegistrationScope | null>(null);
  const locked = scope?.locked ?? null;
  useEffect(() => {
    getRegistrationScope(joining).then(s => {
      setScope(s);
      if (s.locked?.state && s.locked.district) {
        setStateId(s.locked.state.id);
        setDistrictId(s.locked.district.id);
      } else if (s.places.length === 1 && s.places[0]!.state && s.places[0]!.district) {
        // One project open: its place is the only answer — fill it in.
        setStateId(s.places[0]!.state.id);
        setDistrictId(s.places[0]!.district.id);
      }
    }).catch(() => { /* offer every place, as before */ });
  }, [joining]);
  // A learner who signed up with a mobile number already gave it.
  useEffect(() => { if (user?.phone && !phone) setPhone(user.phone); }, [user?.phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = useLearnerMetadata(
    { departmentId, designationId, stateId, districtId, blockId },
    msg => showToast(msg, 'error'),
    { project: locked ? joining : null },
  );
  const hasSubdivisions = meta.blocks.some(b => b.subdivision);
  const askChildren = maritalStatus !== NEVER_MARRIED;

  const selectedDept = meta.departments.find(d => d.id === Number(departmentId));
  const isOtherDept = selectedDept?.code === 'OTHER';
  const selectedDesignation = meta.designations.find(d => d.id === Number(designationId));
  const isOtherDesignation = selectedDesignation?.is_other ?? false;
  const selectedFacilityType = meta.facilityTypes.find(f => f.id === Number(facilityTypeId));
  const isOtherFacilityType = selectedFacilityType?.is_other ?? false;
  const selectedQual = meta.qualifications.find(q => q.id === Number(qualificationId));
  const showQualOther = selectedQual?.has_semi_open_input ?? false;

  // Clears one field's error the moment the user edits it.
  const clearError = (key: string) =>
    setErrors(e => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));

  // ── Cascade change handlers (set value + reset dependents + clear own error) ──
  const onDepartment = (v: string) => {
    setDepartmentId(v ? Number(v) : ''); setDesignationId(''); setDesignationOther('');
    setFacilityTypeId(''); setFacilityTypeOther(''); setQualificationId('');
    clearError('departmentId');
  };
  const onDesignation = (v: string) => {
    setDesignationId(v ? Number(v) : ''); setDesignationOther(''); setFacilityTypeId(''); setFacilityTypeOther('');
    clearError('designationId');
  };
  const onFacilityType = (v: string) => { setFacilityTypeId(v ? Number(v) : ''); setFacilityTypeOther(''); clearError('facilityTypeId'); };
  const onState = (v: string) => {
    setStateId(v ? Number(v) : ''); setDistrictId(''); setBlockId(''); setVillageId(''); setVillageName(''); setFacilityId(''); setFacilityName('');
    clearError('stateId');
  };
  const onDistrict = (v: string) => { setDistrictId(v ? Number(v) : ''); setBlockId(''); setVillageId(''); setVillageName(''); setFacilityId(''); setFacilityName(''); clearError('districtId'); };
  const onBlock = (v: string) => {
    setBlockId(v ? Number(v) : ''); setVillageId(''); setVillageName(''); setFacilityId(''); setFacilityName('');
    setGpId(''); setGpName(''); clearError('blockId');
  };
  const onMarital = (v: string) => {
    setMaritalStatus(v); clearError('maritalStatus');
    // Never married: the children question is not asked, and the answer is No.
    if (v === NEVER_MARRIED) { setHasChildren('No'); setNumberChildren(''); clearError('hasChildren'); }
  };

  // Village combobox: pick a known village (sets the id) or type a custom name (clears it).
  const onVillagePick = (o: { value: number | string; label: string }) => {
    setVillageId(Number(o.value)); setVillageName(o.label); clearError('villageName');
  };
  const onVillageType = (text: string) => { setVillageName(text); setVillageId(''); clearError('villageName'); };

  // Facility name is typed (review of 17 Oct 2026: "it should be typed, text
  // format, not selection format" — the facility lists are not complete).
  const onFacilityTyped = (text: string) => { setFacilityName(text); setFacilityId(''); clearError('facilityName'); };

  // Age is derived from DOB — display only, never an input.
  const age = ageFromDob(dob);

  const values: LearnerFormValues = {
    dob, age, gender, phone, alternatePhone, maritalStatus, hasChildren, numberChildren,
    departmentId, departmentOther, designationId, designationOther, facilityTypeId, facilityTypeOther,
    stateId, districtId, blockId,
    villageId, villageName, facilityId, facilityName, residenceDistance, qualificationId, qualificationOther,
    yearsService, yearsDesignation, yearsFacility, internetWorkplace, trainings,
    isOtherDept, isOtherDesignation, isOtherFacilityType, showQualificationOther: showQualOther,
  };

  const next = () => {
    const stepErrs = validateLearnerStep(values, step);
    setErrors(stepErrs);
    if (Object.keys(stepErrs).length) return;
    setStep(s => Math.min(s + 1, STEP_KEYS.length - 1));
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
    const toastId = showToast(t('registration.toastSubmitting'), 'loading');
    try {
      const districtName = meta.districts.find(d => d.id === Number(districtId))?.name;
      // role gates profile-complete (auth checks role != null) — when dept = Other or an
      // "Other (Specify)" row is picked, the free-typed text becomes the legacy string.
      const roleName = isOtherDept || isOtherDesignation ? designationOther.trim() : selectedDesignation?.name;
      const facilityTypeName = isOtherDept || isOtherFacilityType ? facilityTypeOther.trim() : selectedFacilityType?.name;

      await updateProfile({
        join_project: joining || undefined,
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
        ...(isOtherDept ? {} : { designation_id: Number(designationId), facility_type_id: Number(facilityTypeId) }),
        role: roleName,
        designation_other: isOtherDept || isOtherDesignation ? designationOther.trim() : undefined,
        work_center_type: facilityTypeName,
        facility_type_other: isOtherDept || isOtherFacilityType ? facilityTypeOther.trim() : undefined,
        // geography: FK + legacy string
        state_id: Number(stateId),
        district_id: Number(districtId),
        block_id: Number(blockId),
        village_id: villageId ? Number(villageId) : null,
        village_name: villageId ? null : (villageName || null),
        gram_panchayat_id: gpId ? Number(gpId) : null,
        gram_panchayat_name: gpId ? null : (gpName.trim() || null),
        facility_id: facilityId ? Number(facilityId) : null,
        district: districtName,
        work_center_name: facilityName.trim() || null,
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
      clearJoinProject();
      // The email address comes last and is optional; a failure here never
      // undoes the registration — it can be added from the profile.
      if (contactEmail.trim() && user?.email_is_placeholder) {
        try {
          const res = await client.post('/api/auth/contact-email', { email: contactEmail.trim() });
          showToast(t(res.data.code_sent ? 'registration.emailCodeSent' : 'registration.emailSaved'), 'info');
        } catch (err: any) {
          const detail = err?.response?.data?.detail;
          showToast(typeof detail === 'string' ? detail : t('registration.emailLater'), 'warning');
        }
      }
      updateToast(toastId, t('registration.toastSuccess'), 'success');
      navigate('/dashboard');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      updateToast(toastId, typeof detail === 'string' ? detail : t('registration.toastFail'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const isLastStep = step === STEP_KEYS.length - 1;

  return (
    <AuthLayout
      title={t('registration.title')}
      subtitle={t('registration.subtitle')}
      onSignOut={() => {
        logout();
        // @ts-ignore
        window.google?.accounts?.id?.disableAutoSelect?.();
        navigate('/login', { replace: true });
      }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-7" noValidate>
        <Stepper steps={steps} current={step} className="mb-1" />

        {/* ── Step 1: Personal ── */}
        {step === 0 && (
          <div>
            <SectionTitle>{t('registration.sectionPersonal')}</SectionTitle>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('fields.dob')} htmlFor="dob-input" error={errors.dob}>
                  <DateInput id="dob-input" value={dob} max={maxDobForAge(18)}
                    error={!!errors.dob} onChange={v => { setDob(v); clearError('dob'); }} />
                </Field>
                <Field label={t('fields.ageYears')}>
                  <div className="rounded-lg border border-border-strong/60 bg-surface-sunken px-3.5 py-2.5 text-sm">
                    {age === '' ? <span className="text-ink-faint">{t('fields.ageCalculated')}</span> : t('fields.ageValue', { age })}
                  </div>
                </Field>
              </div>

              <Field label={t('fields.gender')} error={errors.gender}>
                <div className="mt-1 flex flex-wrap gap-4">
                  {genderOptions(t).map(o => (
                    <Radio key={o.value} name="gender" value={o.value} checked={gender === o.value}
                      onChange={e => { setGender(e.target.value); clearError('gender'); }} label={o.label} />
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('fields.mobileNumber')} htmlFor="phone-input" error={errors.phone}>
                  <Input id="phone-input" type="tel" inputMode="numeric" placeholder={t('fields.phonePlaceholder')}
                    value={phone} error={!!errors.phone}
                    onChange={e => { setPhone(e.target.value); clearError('phone'); }} />
                </Field>
                <Field label={t('fields.alternateNumber')} htmlFor="alt-phone-input" error={errors.alternatePhone}>
                  <Input id="alt-phone-input" type="tel" inputMode="numeric" placeholder={t('fields.optional')}
                    value={alternatePhone} error={!!errors.alternatePhone}
                    onChange={e => { setAlternatePhone(e.target.value); clearError('alternatePhone'); }} />
                </Field>
              </div>

            </div>
          </div>
        )}

        {/* ── Step 2: Work & Location ── */}
        {step === 1 && (
          <div>
            <SectionTitle>{t('registration.sectionWork')}</SectionTitle>
            <div className="flex flex-col gap-4">
              <SelectField label={t('fields.department')} value={departmentId} onChange={onDepartment} error={errors.departmentId}
                placeholder={t('placeholders.selectDepartment')} options={meta.departments.map(d => ({ value: d.id, label: d.name }))} />

              {isOtherDept && (
                <Field label={t('fields.specifyDepartment')} htmlFor="dept-other" error={errors.departmentOther}>
                  <Input id="dept-other" type="text" placeholder={t('fields.enterDepartment')} error={!!errors.departmentOther}
                    value={departmentOther} onChange={e => { setDepartmentOther(e.target.value); clearError('departmentOther'); }} required />
                </Field>
              )}

              {/* Dept = Other: no picked lists apply — designation & facility type become open questions. */}
              {!isOtherDept && (
                <SelectField label={t('fields.designation')} value={designationId} onChange={onDesignation} error={errors.designationId}
                  placeholder={t('placeholders.selectDesignation')} disabled={!departmentId}
                  options={meta.designations.map(d => ({ value: d.id, label: d.name }))} />
              )}

              {(isOtherDept || isOtherDesignation) && (
                <Field label={t('fields.specifyDesignation')} htmlFor="desig-other" error={errors.designationOther}>
                  <Input id="desig-other" type="text" placeholder={t('fields.enterDesignation')} error={!!errors.designationOther}
                    value={designationOther} onChange={e => { setDesignationOther(e.target.value); clearError('designationOther'); }} required />
                </Field>
              )}

              {!isOtherDept && (
                <SelectField label={t('fields.facilityType')} value={facilityTypeId} error={errors.facilityTypeId}
                  onChange={onFacilityType}
                  placeholder={t('placeholders.selectFacilityType')} disabled={!designationId}
                  options={meta.facilityTypes.map(f => ({ value: f.id, label: f.name }))} />
              )}

              {(isOtherDept || isOtherFacilityType) && (
                <Field label={t('fields.specifyFacilityType')} htmlFor="ft-other" error={errors.facilityTypeOther}>
                  <Input id="ft-other" type="text" placeholder={t('fields.enterFacilityType')} error={!!errors.facilityTypeOther}
                    value={facilityTypeOther} onChange={e => { setFacilityTypeOther(e.target.value); clearError('facilityTypeOther'); }} required />
                </Field>
              )}

              {locked && (
                <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm text-ink">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-primary-ink" />
                  <span>{t('registration.lockedPlace', {
                    project: locked.project.name,
                    place: [locked.district?.name, locked.state?.name].filter(Boolean).join(', '),
                  })}</span>
                </div>
              )}

              <SelectField label={<span className="inline-flex items-center gap-1.5">{t('fields.state')}{locked && <Lock className="size-3.5 text-ink-faint" />}</span>}
                value={stateId} onChange={onState} error={errors.stateId} disabled={!!locked}
                placeholder={t('placeholders.selectState')} options={meta.states.map(s => ({ value: s.id, label: s.name }))} />

              <SelectField label={<span className="inline-flex items-center gap-1.5">{t('fields.district')}{locked && <Lock className="size-3.5 text-ink-faint" />}</span>}
                value={districtId} onChange={onDistrict} error={errors.districtId}
                placeholder={t('placeholders.selectDistrict')} disabled={!stateId || !!locked}
                options={meta.districts.map(d => ({ value: d.id, label: d.name }))} />

              <SelectField label={hasSubdivisions ? t('fields.subdivisionTaluk') : t('fields.block')} value={blockId} onChange={onBlock} error={errors.blockId}
                placeholder={t('placeholders.selectTaluk')} disabled={!districtId}
                options={meta.blocks.map(b => ({ value: b.id, label: blockLabel(b) }))} />

              {blockId !== '' && (
                <ComboBox label={t('fields.gramPanchayat')} value={gpName}
                  onValueChange={text => { setGpName(text); setGpId(''); }}
                  onPick={o => { setGpId(Number(o.value)); setGpName(o.label); }}
                  placeholder={meta.gramPanchayats.length ? t('fields.gramPanchayatPlaceholder') : t('fields.gramPanchayatType')}
                  options={meta.gramPanchayats.map(g => ({ value: g.id, label: g.name }))} />
              )}

              <ComboBox label={t('fields.village')} value={villageName} error={errors.villageName}
                onValueChange={onVillageType} onPick={onVillagePick}
                placeholder={t('fields.villageTypePlaceholder')} disabled={!blockId}
                options={meta.villages.map(v => ({ value: v.id, label: v.name }))} />

              <Field label={t('fields.facilityName')} htmlFor="facility-name" error={errors.facilityName}>
                <Input id="facility-name" type="text" placeholder={t('fields.facilityTypePlaceholder')}
                  value={facilityName} error={!!errors.facilityName} disabled={!blockId}
                  onChange={e => onFacilityTyped(e.target.value)} />
              </Field>

              <Field label={t('fields.residenceDistance')} htmlFor="residence-distance" error={errors.residenceDistance}>
                <Input id="residence-distance" type="number" min={0.1} max={100} step={0.1} placeholder={t('fields.residenceDistancePlaceholder')}
                  value={residenceDistance} error={!!errors.residenceDistance}
                  onChange={e => { setResidenceDistance(e.target.value ? Number(e.target.value) : ''); clearError('residenceDistance'); }} />
              </Field>
            </div>
          </div>
        )}

        {/* ── Step 3: Education & Experience ── */}
        {step === 2 && (
          <div>
            <SectionTitle>{t('registration.sectionEducation')}</SectionTitle>
            <div className="flex flex-col gap-4">
              <SelectField label={t('fields.qualification')} value={qualificationId} error={errors.qualificationId}
                onChange={v => { setQualificationId(v ? Number(v) : ''); clearError('qualificationId'); }}
                placeholder={departmentId ? t('placeholders.selectQualification') : t('placeholders.selectDeptFirst')}
                disabled={!departmentId}
                options={meta.qualifications.map(q => ({ value: q.id, label: q.qualification_name }))} />

              {showQualOther && (
                <Field label={t('fields.specifyQualification')} htmlFor="qual-other" error={errors.qualificationOther}>
                  <Input id="qual-other" type="text" placeholder={t('fields.enterDetails')} error={!!errors.qualificationOther}
                    value={qualificationOther} onChange={e => { setQualificationOther(e.target.value); clearError('qualificationOther'); }} required />
                </Field>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label={t('fields.yearsService')} htmlFor="years-service" error={errors.yearsService}>
                  <Input id="years-service" type="number" min={0} max={50} step={0.1} placeholder={t('fields.yearsServicePlaceholder')}
                    value={yearsService} error={!!errors.yearsService}
                    onChange={e => { setYearsService(e.target.value ? Number(e.target.value) : ''); clearError('yearsService'); }} />
                </Field>
                <Field label={t('fields.yearsDesignation')} htmlFor="years-designation" error={errors.yearsDesignation}>
                  <Input id="years-designation" type="number" min={0} max={50} step={0.1} placeholder={t('fields.yearsPlaceholder')}
                    value={yearsDesignation} error={!!errors.yearsDesignation}
                    onChange={e => { setYearsDesignation(e.target.value ? Number(e.target.value) : ''); clearError('yearsDesignation'); }} />
                </Field>
                <Field label={t('fields.yearsFacility')} htmlFor="years-facility" error={errors.yearsFacility}>
                  <Input id="years-facility" type="number" min={0} max={50} step={0.1} placeholder={t('fields.yearsPlaceholder')}
                    value={yearsFacility} error={!!errors.yearsFacility}
                    onChange={e => { setYearsFacility(e.target.value ? Number(e.target.value) : ''); clearError('yearsFacility'); }} />
                </Field>
              </div>

              <SelectField label={t('fields.internet')} value={internetWorkplace}
                error={errors.internetWorkplace}
                onChange={v => { setInternetWorkplace(v); clearError('internetWorkplace'); }} placeholder={t('placeholders.selectOne')}
                options={internetOptions(t)} />

              {/* Personal questions come last (review of 17 Oct 2026), with why they are asked. */}
              <div className="mt-2 rounded-xl border border-border bg-surface-sunken/60 p-4">
                <p className="mb-3 text-sm leading-relaxed text-ink-muted">{t('registration.personalNote')}</p>
                <div className="flex flex-col gap-4">
                  <SelectField label={t('fields.maritalStatus')} value={maritalStatus} error={errors.maritalStatus}
                    onChange={onMarital}
                    placeholder={t('placeholders.selectMarital')} options={maritalOptions(t)} />

                  {askChildren && (
                    <Field label={t('fields.hasChildren')} error={errors.hasChildren}>
                      <div className="mt-1 flex gap-4">
                        {[['Yes', t('options.yes')], ['No', t('options.no')]].map(([val, lbl]) => (
                          <Radio key={val} name="has_children" value={val} checked={hasChildren === val}
                            onChange={e => { setHasChildren(e.target.value); clearError('hasChildren'); }} label={lbl} />
                        ))}
                      </div>
                    </Field>
                  )}

                  {askChildren && hasChildren === 'Yes' && (
                    <Field label={t('fields.numberChildren')} htmlFor="num-children" error={errors.numberChildren}>
                      <Input id="num-children" type="number" min={0} max={10} placeholder={t('fields.numberChildrenPlaceholder')} value={numberChildren}
                        error={!!errors.numberChildren}
                        onChange={e => { setNumberChildren(e.target.value ? Number(e.target.value) : ''); clearError('numberChildren'); }} />
                    </Field>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Training history ── */}
        {step === 3 && (
          <div>
            <SectionTitle>{t('registration.sectionTraining')}</SectionTitle>
            <div className="flex flex-col gap-4">
              {TRAINING_KEYS.map(key => (
                <SelectField key={key} label={t(`trainings.${key}`)} value={trainings[key] ?? ''}
                  error={errors[`trainings.${key}`]}
                  onChange={v => { setTrainings(prev => ({ ...prev, [key]: v })); clearError(`trainings.${key}`); }}
                  placeholder={t('placeholders.selectOne')} options={recencyOptions(t)} />
              ))}

              {user?.email_is_placeholder && (
                <Field label={t('fields.contactEmail')} htmlFor="contact-email">
                  <Input id="contact-email" type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    placeholder={t('fields.contactEmailPlaceholder')} value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)} />
                  <p className="mt-1.5 text-xs text-ink-muted">{t('fields.contactEmailHint')}</p>
                </Field>
              )}
            </div>
          </div>
        )}

        {/* ── Navigation ── */}
        <div className="flex items-center gap-3 border-t border-border pt-5">
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={back} disabled={loading}>
              {t('registration.back')}
            </Button>
          )}
          {!isLastStep ? (
            <Button type="button" onClick={next} fullWidth>
              {t('registration.continue')}
            </Button>
          ) : (
            <Button type="submit" size="lg" fullWidth loading={loading}>
              {loading ? t('registration.submitting') : t('registration.complete')}
            </Button>
          )}
        </div>
      </form>
    </AuthLayout>
  );
};

export default RegistrationPage;
