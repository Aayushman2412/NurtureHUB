import React from 'react';
import { ComboBox, Field, Input, SelectField } from '../../components/ui';
import type { LearnerMetadata } from '../../hooks/useLearnerMetadata';
import { INTERNET, TRAINING_RECENCY, TRAININGS } from '../../lib/learnerFields';
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
}) => (
  <div className="flex flex-col gap-5">
    <SelectField label="Department" value={values.departmentId} onChange={onDepartment} error={errors.departmentId}
      placeholder="Select department" options={meta.departments.map(d => ({ value: d.id, label: d.name }))} />

    {isOtherDept && (
      <Field label="Specify department" htmlFor="dept-other-input" error={errors.departmentOther}>
        <Input id="dept-other-input" type="text" placeholder="Enter department" error={!!errors.departmentOther}
          value={values.departmentOther} onChange={e => onChange('departmentOther', e.target.value)} required />
      </Field>
    )}

    <SelectField label="Designation" value={values.designationId} onChange={onDesignation} error={errors.designationId}
      placeholder="Select designation" disabled={!values.departmentId}
      options={meta.designations.map(d => ({ value: d.id, label: d.name }))} />

    <SelectField label="Facility Type" value={values.facilityTypeId} error={errors.facilityTypeId}
      onChange={v => onChange('facilityTypeId', numOr(v))} placeholder="Select facility type"
      disabled={!values.designationId} options={meta.facilityTypes.map(f => ({ value: f.id, label: f.name }))} />

    <SelectField label="State" value={values.stateId} onChange={onState} error={errors.stateId}
      placeholder="Select state" options={meta.states.map(s => ({ value: s.id, label: s.name }))} />

    <SelectField label="District" value={values.districtId} onChange={onDistrict} error={errors.districtId}
      placeholder="Select district" disabled={!values.stateId}
      options={meta.districts.map(d => ({ value: d.id, label: d.name }))} />

    <SelectField label="Taluk / Block" value={values.blockId} onChange={onBlock} error={errors.blockId}
      placeholder="Select taluk" disabled={!values.districtId}
      options={meta.blocks.map(b => ({ value: b.id, label: b.name }))} />

    <ComboBox label="Workplace Village / City" value={values.villageName} error={errors.villageName}
      onValueChange={t => { onChange('villageName', t); onChange('villageId', ''); }}
      onPick={o => { onChange('villageName', o.label); onChange('villageId', Number(o.value)); }}
      placeholder="Search or type your village" disabled={!values.blockId}
      options={meta.villages.map(v => ({ value: v.id, label: v.name }))} />

    <SelectField label="Facility Name" value={values.facilityId} error={errors.facilityId}
      onChange={v => onChange('facilityId', numOr(v))} placeholder="Select facility"
      disabled={!values.blockId}
      options={meta.facilities.map(f => ({ value: f.id, label: `${f.name} (${f.facility_type})` }))} />

    <Field label="Distance from residence to workplace (km)" htmlFor="residence-distance-input" error={errors.residenceDistance}>
      <Input id="residence-distance-input" type="number" min={0} max={100} step={0.1} placeholder="e.g. 5.5"
        value={values.residenceDistance} error={!!errors.residenceDistance}
        onChange={e => onChange('residenceDistance', numOr(e.target.value))} />
    </Field>

    <SelectField label="Highest Educational Qualification" value={values.qualificationId} error={errors.qualificationId}
      onChange={v => onChange('qualificationId', numOr(v))}
      placeholder={values.departmentId ? 'Select qualification' : 'Select a department first'}
      disabled={!values.departmentId}
      options={meta.qualifications.map(q => ({ value: q.id, label: q.qualification_name }))} />

    {showQualificationOther && (
      <Field label="Please specify qualification" htmlFor="qualification-other-input" error={errors.qualificationOther}>
        <Input id="qualification-other-input" type="text" placeholder="Enter details..." error={!!errors.qualificationOther}
          value={values.qualificationOther} onChange={e => onChange('qualificationOther', e.target.value)} required />
      </Field>
    )}

    <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
      <Field label="Total years of service" htmlFor="years-service-input" error={errors.yearsService}>
        <Input id="years-service-input" type="number" min={0} max={50} step={0.1} placeholder="0–50"
          value={values.yearsService} error={!!errors.yearsService}
          onChange={e => onChange('yearsService', numOr(e.target.value))} />
      </Field>
      <Field label="Years in current designation" htmlFor="years-designation-input" error={errors.yearsDesignation}>
        <Input id="years-designation-input" type="number" min={0} max={50} step={0.1} placeholder="years"
          value={values.yearsDesignation} error={!!errors.yearsDesignation}
          onChange={e => onChange('yearsDesignation', numOr(e.target.value))} />
      </Field>
      <Field label="Years at current facility" htmlFor="years-facility-input" error={errors.yearsFacility}>
        <Input id="years-facility-input" type="number" min={0} max={50} step={0.1} placeholder="years"
          value={values.yearsFacility} error={!!errors.yearsFacility}
          onChange={e => onChange('yearsFacility', numOr(e.target.value))} />
      </Field>
    </div>

    <SelectField label="Is internet connectivity adequate in your work area?" value={values.internetWorkplace}
      error={errors.internetWorkplace}
      onChange={v => onChange('internetWorkplace', v)} placeholder="Select one"
      options={INTERNET.map(i => ({ value: i, label: i }))} />

    {TRAININGS.map(t => (
      <SelectField key={t.key} label={t.label} value={values.trainings[t.key] ?? ''}
        error={errors[`trainings.${t.key}`]}
        onChange={v => onChange('trainings', { ...values.trainings, [t.key]: v })}
        placeholder="Select one" options={TRAINING_RECENCY.map(r => ({ value: r, label: r }))} />
    ))}
  </div>
);

export default WorkDetailsTab;
