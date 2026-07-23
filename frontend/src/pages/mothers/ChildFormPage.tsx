import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../context/ToastContext';
import {
  Button, Card, Checkbox, DateInput, Field, Input, PageHeader, PageLoader, Radio, SelectField, Stepper,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import {
  childAge, babiesBornOptions, genderOptions, deliveryMethodOptions, deliveryPlaceOptions, birthConditionOptions,
} from '../../lib/childFields';
import { validateChild, validateChildStep, CR_STEP_FIELDS, type ChildFormValues } from '../../lib/childSchema';
import type { FieldErrors } from '../../lib/validation';
import { createChild, getChild, updateChild, type ChildPayload } from '../../api/children';
import { getMother } from '../../api/mothers';

const STEP_KEYS = ['birth', 'delivery'] as const;
const today = () => new Date().toISOString().slice(0, 10);

const ReadOnly: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <Field label={label}>
    <div className="rounded-lg border border-border-strong/60 bg-surface-sunken px-3.5 py-2.5 text-sm">
      {value ? value : <span className="text-ink-faint">{hint}</span>}
    </div>
  </Field>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-4 border-b-2 border-coral-100 pb-2 text-[13px] font-bold uppercase tracking-wider
                  text-primary-ink dark:border-coral-950">{children}</div>
);

const YesNo: React.FC<{ name: string; value: string; onChange: (v: string) => void }> = ({ name, value, onChange }) => {
  const { t } = useTranslation('mother');
  const opts: [string, string][] = [['Yes', t('options.yes')], ['No', t('options.no')]];
  return (
    <div className="mt-1 flex gap-4">
      {opts.map(([val, lbl]) => (
        <Radio key={val} name={name} value={val} checked={value === val} onChange={e => onChange(e.target.value)} label={lbl} />
      ))}
    </div>
  );
};

const ChildFormPage: React.FC = () => {
  const { motherId: motherIdParam, childId: childIdParam } = useParams();
  const motherId = Number(motherIdParam);
  const childId = childIdParam ? Number(childIdParam) : null;
  const isEdit = childId != null;
  const navigate = useNavigate();
  const { t } = useTranslation('mother');
  const { showToast, updateToast } = useToast();
  const steps = STEP_KEYS.map(k => t(`child.steps.${k}`));

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(isEdit);
  const [motherName, setMotherName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  // Step 1 — birth
  const [babiesBorn, setBabiesBorn] = useState('');
  const [adoptionDate, setAdoptionDate] = useState('');
  const [childName, setChildName] = useState('');
  const [dob, setDob] = useState('');
  const [birthWeight, setBirthWeight] = useState<number | ''>('');
  const [birthLength, setBirthLength] = useState<number | ''>('');
  const [gender, setGender] = useState('');
  const [previousLivingChildren, setPreviousLivingChildren] = useState<number | ''>('');

  // Step 2 — delivery & feeding
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [deliveryPlace, setDeliveryPlace] = useState('');
  const [deliveryPlaceOther, setDeliveryPlaceOther] = useState('');
  const [bfWithinOneHour, setBfWithinOneHour] = useState('');   // 'Yes' | 'No'
  const [ebfDuringStay, setEbfDuringStay] = useState('');        // 'Yes' | 'No'
  const [ebfReason, setEbfReason] = useState('');
  const [birthConditions, setBirthConditions] = useState<string[]>([]);
  const [preExistingOther, setPreExistingOther] = useState('');

  const backTo = `/mothers/${motherId}`;

  // Load the mother (for the header) and, in edit mode, the child to prefill.
  useEffect(() => {
    getMother(motherId).then(m => setMotherName(m.mother_name)).catch(() => {});
    if (!isEdit) return;
    getChild(motherId, childId)
      .then(c => {
        setBabiesBorn(c.babies_born ?? '');
        setAdoptionDate(c.adoption_date ?? '');
        setChildName(c.child_name ?? '');
        setDob(c.dob ?? '');
        setBirthWeight(c.birth_weight ?? '');
        setBirthLength(c.birth_length == null ? '' : Math.round(c.birth_length * 10) / 10);
        setGender(c.gender ?? '');
        setPreviousLivingChildren(c.previous_living_children ?? '');
        setDeliveryMethod(c.delivery_method ?? '');
        setDeliveryPlace(c.delivery_place ?? '');
        setDeliveryPlaceOther(c.delivery_place_other ?? '');
        setBfWithinOneHour(c.bf_within_one_hour == null ? '' : c.bf_within_one_hour ? 'Yes' : 'No');
        setEbfDuringStay(c.ebf_during_stay == null ? '' : c.ebf_during_stay ? 'Yes' : 'No');
        setEbfReason(c.ebf_reason ?? '');
        setBirthConditions((c.birth_conditions ?? []).map(b => b.condition));
        setPreExistingOther(c.pre_existing_other ?? '');
      })
      .catch(() => showToast(t('child.loadFailed'), 'error'))
      .finally(() => setHydrating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motherId, childId]);

  const showDeliveryPlaceOther = deliveryPlace === 'Other';
  const showEbfReason = ebfDuringStay === 'No';
  const showConditionOther = birthConditions.includes('Others');
  const age = childAge(dob);

  const clearError = (key: string) =>
    setErrors(e => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));

  // "None" is mutually exclusive with the actual conditions.
  const toggleCondition = (cond: string) => {
    setBirthConditions(prev => {
      if (prev.includes(cond)) return prev.filter(c => c !== cond);
      if (cond === 'None') return ['None'];
      return [...prev.filter(c => c !== 'None'), cond];
    });
    clearError('pre_existing_other');
  };

  const values: ChildFormValues = useMemo(() => ({
    babies_born: babiesBorn, adoption_date: adoptionDate, child_name: childName, dob,
    birth_weight: birthWeight, birth_length: birthLength, gender, previous_living_children: previousLivingChildren,
    delivery_method: deliveryMethod, delivery_place: deliveryPlace, delivery_place_other: deliveryPlaceOther,
    bf_within_one_hour: bfWithinOneHour, ebf_during_stay: ebfDuringStay, ebf_reason: ebfReason,
    birth_conditions: birthConditions, pre_existing_other: preExistingOther,
    showDeliveryPlaceOther, showEbfReason, showConditionOther, isEdit,
  }), [babiesBorn, adoptionDate, childName, dob, birthWeight, birthLength, gender, previousLivingChildren,
    deliveryMethod, deliveryPlace, deliveryPlaceOther, bfWithinOneHour, ebfDuringStay, ebfReason,
    birthConditions, preExistingOther, showDeliveryPlaceOther, showEbfReason, showConditionOther, isEdit]);

  const next = () => {
    const stepErrs = validateChildStep(values, step);
    setErrors(stepErrs);
    if (!Object.keys(stepErrs).length) setStep(s => Math.min(s + 1, STEP_KEYS.length - 1));
  };
  const back = () => { setErrors({}); setStep(s => Math.max(s - 1, 0)); };

  const buildPayload = (): ChildPayload => ({
    babies_born: babiesBorn || null, adoption_date: adoptionDate || null, child_name: childName,
    dob: dob || null, birth_weight: birthWeight === '' ? null : Number(birthWeight),
    birth_length: birthLength === '' ? null : Math.round(Number(birthLength) * 10) / 10, gender: gender || null,
    previous_living_children: previousLivingChildren === '' ? null : Number(previousLivingChildren),
    delivery_method: deliveryMethod || null, delivery_place: deliveryPlace || null,
    delivery_place_other: showDeliveryPlaceOther ? deliveryPlaceOther : null,
    bf_within_one_hour: bfWithinOneHour === '' ? null : bfWithinOneHour === 'Yes',
    ebf_during_stay: ebfDuringStay === '' ? null : ebfDuringStay === 'Yes',
    ebf_reason: showEbfReason ? ebfReason : null,
    pre_existing_other: showConditionOther ? preExistingOther : null,
    birth_conditions: birthConditions.map(c => ({ condition: c })),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A submit (e.g. Enter in a field) on a non-final step advances the wizard — never saves.
    // Without this, edit mode (form pre-filled & valid) would save on the first Enter press.
    if (step !== STEP_KEYS.length - 1) {
      next();
      return;
    }
    const allErrs = validateChild(values);
    if (Object.keys(allErrs).length) {
      setErrors(allErrs);
      const firstStep = CR_STEP_FIELDS.findIndex(keys => keys.some(k => allErrs[k]));
      if (firstStep >= 0) setStep(firstStep);
      return;
    }
    setLoading(true);
    const toastId = showToast(isEdit ? t('child.toastSaving') : t('child.toastRegistering'), 'loading');
    try {
      const saved = isEdit
        ? await updateChild(motherId, childId, buildPayload())
        : await createChild(motherId, buildPayload());
      updateToast(
        toastId,
        isEdit
          ? t('child.toastSuccessSaved', { name: saved.child_name, uid: saved.child_uid })
          : t('child.toastSuccessRegistered', { name: saved.child_name, uid: saved.child_uid }),
        'success',
      );
      navigate(backTo);
    } catch {
      updateToast(toastId, isEdit ? t('child.toastFailSave') : t('child.toastFailRegister'), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (hydrating) return <PageLoader label={t('child.loading')} className="min-h-60" />;

  const isLast = step === STEP_KEYS.length - 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={isEdit ? t('child.titleEdit') : t('child.titleNew')}
        description={motherName ? t('child.descLinked', { name: motherName }) : t('child.descLinkedFallback')}
        backTo={backTo}
      />
      <Card className="p-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-7" noValidate>
          <Stepper steps={steps} current={step} />

          {step === 0 && (
            <div>
              <SectionTitle>{t('child.sectionBirth')}</SectionTitle>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SelectField label={t('child.babiesBorn')} value={babiesBorn}
                    onChange={v => { setBabiesBorn(v); clearError('babies_born'); }} error={errors.babies_born}
                    placeholder={t('child.placeholders.select')} options={babiesBornOptions(t)} />
                  <Field label={t('child.childName')} error={errors.child_name}>
                    <Input value={childName} error={!!errors.child_name}
                      onChange={e => { setChildName(e.target.value); clearError('child_name'); }} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label={t('child.adoptionDate')} error={errors.adoption_date}>
                    <DateInput value={adoptionDate} max={today()} error={!!errors.adoption_date}
                      onChange={v => { setAdoptionDate(v); clearError('adoption_date'); }} />
                  </Field>
                  <Field label={t('child.dob')} error={errors.dob}>
                    <DateInput value={dob} max={today()} error={!!errors.dob}
                      onChange={v => { setDob(v); clearError('dob'); }} />
                  </Field>
                  <ReadOnly label={t('child.age')} value={age ? t('child.ageValue', { days: age.days, months: age.months }) : ''} hint={t('child.ageHint')} />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label={t('child.birthWeight')} error={errors.birth_weight}>
                    <Input type="number" step={0.001} min={1} max={5} placeholder={t('child.birthWeightPlaceholder')} value={birthWeight}
                      error={!!errors.birth_weight}
                      onChange={e => { setBirthWeight(e.target.value === '' ? '' : Number(e.target.value)); clearError('birth_weight'); }} />
                  </Field>
                  <Field label={t('child.birthLength')} error={errors.birth_length}>
                    <Input type="number" step={0.1} min={30} max={65} placeholder={t('child.birthLengthPlaceholder')} value={birthLength}
                      error={!!errors.birth_length}
                      onChange={e => { setBirthLength(e.target.value === '' ? '' : Number(e.target.value)); clearError('birth_length'); }} />
                  </Field>
                  <SelectField label={t('child.gender')} value={gender} onChange={v => { setGender(v); clearError('gender'); }}
                    error={errors.gender} placeholder={t('child.placeholders.select')} options={genderOptions(t)} />
                </div>
                <Field label={t('child.previousChildren')} error={errors.previous_living_children}>
                  <Input type="number" min={0} max={10} value={previousLivingChildren} error={!!errors.previous_living_children}
                    onChange={e => { setPreviousLivingChildren(e.target.value === '' ? '' : Number(e.target.value)); clearError('previous_living_children'); }} />
                </Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <SectionTitle>{t('child.sectionDelivery')}</SectionTitle>
              <div className="flex flex-col gap-4">
                <SelectField label={t('child.deliveryMethod')} value={deliveryMethod}
                  onChange={v => { setDeliveryMethod(v); clearError('delivery_method'); }} error={errors.delivery_method}
                  placeholder={t('child.placeholders.selectDeliveryMethod')} options={deliveryMethodOptions(t)} />
                <SelectField label={t('child.deliveryPlace')} value={deliveryPlace}
                  onChange={v => { setDeliveryPlace(v); clearError('delivery_place'); }} error={errors.delivery_place}
                  placeholder={t('child.placeholders.selectPlace')} options={deliveryPlaceOptions(t)} />
                {showDeliveryPlaceOther && (
                  <Field label={t('child.deliveryPlaceOther')} error={errors.delivery_place_other}>
                    <Input value={deliveryPlaceOther} error={!!errors.delivery_place_other}
                      onChange={e => { setDeliveryPlaceOther(e.target.value); clearError('delivery_place_other'); }} />
                  </Field>
                )}
                <Field label={t('child.bfWithinHour')} error={errors.bf_within_one_hour}>
                  <YesNo name="bf_within_one_hour" value={bfWithinOneHour}
                    onChange={v => { setBfWithinOneHour(v); clearError('bf_within_one_hour'); }} />
                </Field>
                <Field label={t('child.ebfDuringStay')} error={errors.ebf_during_stay}>
                  <YesNo name="ebf_during_stay" value={ebfDuringStay}
                    onChange={v => { setEbfDuringStay(v); clearError('ebf_during_stay'); }} />
                </Field>
                {showEbfReason && (
                  <Field label={t('child.ebfReason')} error={errors.ebf_reason}>
                    <textarea rows={3} value={ebfReason} className={inputClasses(false, !!errors.ebf_reason)}
                      onChange={e => { setEbfReason(e.target.value); clearError('ebf_reason'); }} />
                  </Field>
                )}
                <Field label={t('child.birthConditions')}>
                  <div className="mt-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {birthConditionOptions(t).map(c => (
                      <Checkbox key={c.value} label={c.label} checked={birthConditions.includes(c.value)} onChange={() => toggleCondition(c.value)} />
                    ))}
                  </div>
                </Field>
                {showConditionOther && (
                  <Field label={t('child.conditionOther')} error={errors.pre_existing_other}>
                    <Input value={preExistingOther} error={!!errors.pre_existing_other}
                      onChange={e => { setPreExistingOther(e.target.value); clearError('pre_existing_other'); }} />
                  </Field>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-5">
            <Button type="button" variant="ghost" onClick={() => navigate(backTo)} disabled={loading}>{t('child.cancel')}</Button>
            {step > 0 && <Button type="button" variant="secondary" onClick={back} disabled={loading}>{t('child.back')}</Button>}
            {!isLast ? (
              <Button type="button" onClick={next} className="ml-auto">{t('child.continue')}</Button>
            ) : (
              <Button type="submit" size="lg" loading={loading} className="ml-auto">
                {loading ? t('child.saving') : isEdit ? t('child.saveChild') : t('child.registerChild')}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
};

export default ChildFormPage;
