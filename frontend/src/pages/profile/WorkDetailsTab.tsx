import React from 'react';
import { useTranslation } from 'react-i18next';
import { ComboBox, Field, Input, SelectField } from '../../components/ui';
import type { LearnerMetadata } from '../../hooks/useLearnerMetadata';
import { TRAINING_KEYS, internetOptions, recencyOptions } from '../../lib/learnerFields';
import type { FieldErrors } from '../../lib/validation';

export interface WorkDetailsValues {
  departmentId: number | '';
  departmentOther: string;
  designationId: number | '';
  facilityTypeId: number | '';
  stateId: number | '';
  districtId: number | '';
  blockId: number | '';
  villageId: number | '';
  villageName: string;
  facilityId: number | '';
  residenceDistance: number | '';
  qualificationId: number | '';
  qualificationOther: string;
  yearsService: number | '';
  yearsDesignation: number | '';
  yearsFacility: number | '';
  internetWorkplace: string;
  trainings: Record<string, string>;
}

interface WorkDetailsTabProps {
  values: WorkDetailsValues;
  meta: LearnerMetadata;
  errors: FieldErrors;
  isOtherDept: boolean;
  showQualificationOther: boolean;
  onChange: <K extends keyof WorkDetailsValues>(key: K, value: WorkDetailsValues[K]) => void;
  // cascade handlers (set + reset dependents) live in the parent
  onDepartment: (v: string) => void;
  onDesignation: (v: string) => void;
  onState: (v: string) => void;
  onDistrict: (v: string) => void;
  onBlock: (v: string) => void;
}

const numOr = (v: string): number | '' => (v ? Number(v) : '');

const WorkDetailsTab: React.FC<WorkDetailsTabProps> = ({
  values, meta, errors, isOtherDept, showQualificationOther, onChange,
  onDepartment, onDesignation, onState, onDistrict, onBlock,
}) => {
  const { t } = useTranslation('learner');
  return (
  <div className="flex flex-col gap-5">
    <SelectField label={t('fields.department')} value={values.departmentId} onChange={onDepartment} error={errors.departmentId}
      placeholder={t('placeholders.selectDepartment')} options={meta.departments.map(d => ({ value: d.id, label: d.name }))} />

    {isOtherDept && (
      <Field label={t('fields.specifyDepartment')} htmlFor="dept-other-input" error={errors.departmentOther}>
        <Input id="dept-other-input" type="text" placeholder={t('fields.enterDepartment')} error={!!errors.departmentOther}
          value={values.departmentOther} onChange={e => onChange('departmentOther', e.target.value)} required />
      </Field>
    )}

    <SelectField label={t('fields.designation')} value={values.designationId} onChange={onDesignation} error={errors.designationId}
      placeholder={t('placeholders.selectDesignation')} disabled={!values.departmentId}
      options={meta.designations.map(d => ({ value: d.id, label: d.name }))} />

    <SelectField label={t('fields.facilityType')} value={values.facilityTypeId} error={errors.facilityTypeId}
      onChange={v => onChange('facilityTypeId', numOr(v))} placeholder={t('placeholders.selectFacilityType')}
      disabled={!values.designationId} options={meta.facilityTypes.map(f => ({ value: f.id, label: f.name }))} />

    <SelectField label={t('fields.state')} value={values.stateId} onChange={onState} error={errors.stateId}
      placeholder={t('placeholders.selectState')} options={meta.states.map(s => ({ value: s.id, label: s.name }))} />

    <SelectField label={t('fields.district')} value={values.districtId} onChange={onDistrict} error={errors.districtId}
      placeholder={t('placeholders.selectDistrict')} disabled={!values.stateId}
      options={meta.districts.map(d => ({ value: d.id, label: d.name }))} />

    <SelectField label={t('fields.block')} value={values.blockId} onChange={onBlock} error={errors.blockId}
      placeholder={t('placeholders.selectTaluk')} disabled={!values.districtId}
      options={meta.blocks.map(b => ({ value: b.id, label: b.name }))} />

    <ComboBox label={t('fields.villageCity')} value={values.villageName} error={errors.villageName}
      onValueChange={txt => { onChange('villageName', txt); onChange('villageId', ''); }}
      onPick={o => { onChange('villageName', o.label); onChange('villageId', Number(o.value)); }}
      placeholder={t('fields.villagePlaceholder')} disabled={!values.blockId}
      options={meta.villages.map(v => ({ value: v.id, label: v.name }))} />

    <SelectField label={t('fields.facilityName')} value={values.facilityId} error={errors.facilityId}
      onChange={v => onChange('facilityId', numOr(v))} placeholder={t('placeholders.selectFacility')}
      disabled={!values.blockId}
      options={meta.facilities.map(f => ({ value: f.id, label: `${f.name} (${f.facility_type})` }))} />

    <Field label={t('fields.residenceDistance')} htmlFor="residence-distance-input" error={errors.residenceDistance}>
      <Input id="residence-distance-input" type="number" min={0} max={100} step={0.1} placeholder={t('fields.residenceDistancePlaceholder')}
        value={values.residenceDistance} error={!!errors.residenceDistance}
        onChange={e => onChange('residenceDistance', numOr(e.target.value))} />
    </Field>

    <SelectField label={t('fields.qualification')} value={values.qualificationId} error={errors.qualificationId}
      onChange={v => onChange('qualificationId', numOr(v))}
      placeholder={values.departmentId ? t('placeholders.selectQualification') : t('placeholders.selectDeptFirst')}
      disabled={!values.departmentId}
      options={meta.qualifications.map(q => ({ value: q.id, label: q.qualification_name }))} />

    {showQualificationOther && (
      <Field label={t('fields.specifyQualification')} htmlFor="qualification-other-input" error={errors.qualificationOther}>
        <Input id="qualification-other-input" type="text" placeholder={t('fields.enterDetails')} error={!!errors.qualificationOther}
          value={values.qualificationOther} onChange={e => onChange('qualificationOther', e.target.value)} required />
      </Field>
    )}

    <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
      <Field label={t('fields.yearsService')} htmlFor="years-service-input" error={errors.yearsService}>
        <Input id="years-service-input" type="number" min={0} max={50} step={0.1} placeholder={t('fields.yearsServicePlaceholder')}
          value={values.yearsService} error={!!errors.yearsService}
          onChange={e => onChange('yearsService', numOr(e.target.value))} />
      </Field>
      <Field label={t('fields.yearsDesignation')} htmlFor="years-designation-input" error={errors.yearsDesignation}>
        <Input id="years-designation-input" type="number" min={0} max={50} step={0.1} placeholder={t('fields.yearsPlaceholder')}
          value={values.yearsDesignation} error={!!errors.yearsDesignation}
          onChange={e => onChange('yearsDesignation', numOr(e.target.value))} />
      </Field>
      <Field label={t('fields.yearsFacility')} htmlFor="years-facility-input" error={errors.yearsFacility}>
        <Input id="years-facility-input" type="number" min={0} max={50} step={0.1} placeholder={t('fields.yearsPlaceholder')}
          value={values.yearsFacility} error={!!errors.yearsFacility}
          onChange={e => onChange('yearsFacility', numOr(e.target.value))} />
      </Field>
    </div>

    <SelectField label={t('fields.internet')} value={values.internetWorkplace}
      error={errors.internetWorkplace}
      onChange={v => onChange('internetWorkplace', v)} placeholder={t('placeholders.selectOne')}
      options={internetOptions(t)} />

    {TRAINING_KEYS.map(key => (
      <SelectField key={key} label={t(`trainings.${key}`)} value={values.trainings[key] ?? ''}
        error={errors[`trainings.${key}`]}
        onChange={v => onChange('trainings', { ...values.trainings, [key]: v })}
        placeholder={t('placeholders.selectOne')} options={recencyOptions(t)} />
    ))}
  </div>
  );
};

export default WorkDetailsTab;
