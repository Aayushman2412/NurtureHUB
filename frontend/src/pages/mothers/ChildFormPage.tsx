import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import {
  Button, Card, Checkbox, DateInput, Field, Input, PageHeader, PageLoader, Radio, SelectField, Stepper,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import {
  BABIES_BORN, GENDERS, DELIVERY_METHODS, DELIVERY_PLACES, BIRTH_CONDITIONS, childAge,
} from '../../lib/childFields';
import { validateChild, validateChildStep, CR_STEP_FIELDS, type ChildFormValues } from '../../lib/childSchema';
import type { FieldErrors } from '../../lib/validation';
import { createChild, getChild, updateChild, type ChildPayload } from '../../api/children';
import { getMother } from '../../api/mothers';

const STEPS = ['Birth Details', 'Delivery & Feeding'];
const opts = (list: string[]) => list.map(o => ({ value: o, label: o }));
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
                  text-primary dark:border-coral-950">{children}</div>
);

const YesNo: React.FC<{ name: string; value: string; onChange: (v: string) => void }> = ({ name, value, onChange }) => (
  <div className="mt-1 flex gap-4">
    {['Yes', 'No'].map(o => (
      <Radio key={o} name={name} value={o} checked={value === o} onChange={e => onChange(e.target.value)} label={o} />
    ))}
  </div>
);

const ChildFormPage: React.FC = () => {
  const { motherId: motherIdParam, childId: childIdParam } = useParams();
  const motherId = Number(motherIdParam);
  const childId = childIdParam ? Number(childIdParam) : null;
  const isEdit = childId != null;
  const navigate = useNavigate();
  const { showToast, updateToast } = useToast();

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
      .catch(() => showToast('Failed to load child', 'error'))
      .finally(() => setHydrating(false));
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
    if (!Object.keys(stepErrs).length) setStep(s => Math.min(s + 1, STEPS.length - 1));
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
    if (step !== STEPS.length - 1) {
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
    const toastId = showToast(isEdit ? 'Saving child...' : 'Registering child...', 'loading');
    try {
      const saved = isEdit
        ? await updateChild(motherId, childId, buildPayload())
        : await createChild(motherId, buildPayload());
      updateToast(toastId, `${isEdit ? 'Saved' : 'Registered'} ${saved.child_name} (${saved.child_uid}).`, 'success');
      navigate(backTo);
    } catch {
      updateToast(toastId, `Failed to ${isEdit ? 'save' : 'register'}. Please try again.`, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (hydrating) return <PageLoader label="Loading" className="min-h-60" />;

  const isLast = step === STEPS.length - 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={isEdit ? 'Edit Child' : 'Register a Child'}
        description={motherName ? `Linked to ${motherName}` : 'Linked to the selected mother.'}
        backTo={backTo}
      />
      <Card className="p-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-7" noValidate>
          <Stepper steps={STEPS} current={step} />

          {step === 0 && (
            <div>
              <SectionTitle>Birth Details</SectionTitle>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SelectField label="Babies born in this delivery" value={babiesBorn}
                    onChange={v => { setBabiesBorn(v); clearError('babies_born'); }} error={errors.babies_born}
                    placeholder="Select" options={opts(BABIES_BORN)} />
                  <Field label="Baby's name" error={errors.child_name}>
                    <Input value={childName} error={!!errors.child_name}
                      onChange={e => { setChildName(e.target.value); clearError('child_name'); }} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Date of adoption" error={errors.adoption_date}>
                    <DateInput value={adoptionDate} max={today()} error={!!errors.adoption_date}
                      onChange={v => { setAdoptionDate(v); clearError('adoption_date'); }} />
                  </Field>
                  <Field label="Date of birth" error={errors.dob}>
                    <DateInput value={dob} max={today()} error={!!errors.dob}
                      onChange={v => { setDob(v); clearError('dob'); }} />
                  </Field>
                  <ReadOnly label="Age (auto)" value={age ? `${age.days} days · ${age.months} months` : ''} hint="Set DOB to calculate" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Birth weight (kg)" error={errors.birth_weight}>
                    <Input type="number" step={0.001} min={1} max={5} placeholder="1.000–5.000" value={birthWeight}
                      error={!!errors.birth_weight}
                      onChange={e => { setBirthWeight(e.target.value === '' ? '' : Number(e.target.value)); clearError('birth_weight'); }} />
                  </Field>
                  <Field label="Birth length (cm)" error={errors.birth_length}>
                    <Input type="number" step={0.1} min={30} max={65} placeholder="30.0–65.0" value={birthLength}
                      error={!!errors.birth_length}
                      onChange={e => { setBirthLength(e.target.value === '' ? '' : Number(e.target.value)); clearError('birth_length'); }} />
                  </Field>
                  <SelectField label="Gender" value={gender} onChange={v => { setGender(v); clearError('gender'); }}
                    error={errors.gender} placeholder="Select" options={opts(GENDERS)} />
                </div>
                <Field label="Previous living children (apart from this child)" error={errors.previous_living_children}>
                  <Input type="number" min={0} max={10} value={previousLivingChildren} error={!!errors.previous_living_children}
                    onChange={e => { setPreviousLivingChildren(e.target.value === '' ? '' : Number(e.target.value)); clearError('previous_living_children'); }} />
                </Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <SectionTitle>Delivery &amp; Feeding</SectionTitle>
              <div className="flex flex-col gap-4">
                <SelectField label="Delivery method" value={deliveryMethod}
                  onChange={v => { setDeliveryMethod(v); clearError('delivery_method'); }} error={errors.delivery_method}
                  placeholder="Select delivery method" options={opts(DELIVERY_METHODS)} />
                <SelectField label="Place of delivery" value={deliveryPlace}
                  onChange={v => { setDeliveryPlace(v); clearError('delivery_place'); }} error={errors.delivery_place}
                  placeholder="Select place of delivery" options={opts(DELIVERY_PLACES)} />
                {showDeliveryPlaceOther && (
                  <Field label="Specify other place of delivery" error={errors.delivery_place_other}>
                    <Input value={deliveryPlaceOther} error={!!errors.delivery_place_other}
                      onChange={e => { setDeliveryPlaceOther(e.target.value); clearError('delivery_place_other'); }} />
                  </Field>
                )}
                <Field label="Was breastfeeding initiated within one hour of birth?" error={errors.bf_within_one_hour}>
                  <YesNo name="bf_within_one_hour" value={bfWithinOneHour}
                    onChange={v => { setBfWithinOneHour(v); clearError('bf_within_one_hour'); }} />
                </Field>
                <Field label="Was the baby exclusively breastfed during the facility stay after delivery?" error={errors.ebf_during_stay}>
                  <YesNo name="ebf_during_stay" value={ebfDuringStay}
                    onChange={v => { setEbfDuringStay(v); clearError('ebf_during_stay'); }} />
                </Field>
                {showEbfReason && (
                  <Field label="If not, mention the reason" error={errors.ebf_reason}>
                    <textarea rows={3} value={ebfReason} className={inputClasses(false, !!errors.ebf_reason)}
                      onChange={e => { setEbfReason(e.target.value); clearError('ebf_reason'); }} />
                  </Field>
                )}
                <Field label="Pre-existing ill-health conditions at birth (select all that apply)">
                  <div className="mt-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {BIRTH_CONDITIONS.map(c => (
                      <Checkbox key={c} label={c} checked={birthConditions.includes(c)} onChange={() => toggleCondition(c)} />
                    ))}
                  </div>
                </Field>
                {showConditionOther && (
                  <Field label="Specify the other health condition(s)" error={errors.pre_existing_other}>
                    <Input value={preExistingOther} error={!!errors.pre_existing_other}
                      onChange={e => { setPreExistingOther(e.target.value); clearError('pre_existing_other'); }} />
                  </Field>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-5">
            <Button type="button" variant="ghost" onClick={() => navigate(backTo)} disabled={loading}>Cancel</Button>
            {step > 0 && <Button type="button" variant="secondary" onClick={back} disabled={loading}>Back</Button>}
            {!isLast ? (
              <Button type="button" onClick={next} className="ml-auto">Continue</Button>
            ) : (
              <Button type="submit" size="lg" loading={loading} className="ml-auto">
                {loading ? 'Saving...' : isEdit ? 'Save Child ✓' : 'Register Child ✓'}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
};

export default ChildFormPage;
