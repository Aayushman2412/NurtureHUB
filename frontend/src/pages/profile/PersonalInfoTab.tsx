import React from 'react';
import { User, Phone } from 'lucide-react';
import { DateInput, Field, Input, Radio, Select } from '../../components/ui';
import { GENDERS, MARITAL, ageFromDob } from '../../lib/learnerFields';
import type { FieldErrors } from '../../lib/validation';

export interface PersonalInfoValues {
  fullName: string;
  dob: string;
  gender: string;
  phone: string;
  alternatePhone: string;
  maritalStatus: string;
  hasChildren: string;              // 'Yes' | 'No' | ''
  numberChildren: number | '';
}

interface PersonalInfoTabProps extends PersonalInfoValues {
  errors: FieldErrors;
  onChange: <K extends keyof PersonalInfoValues>(key: K, value: PersonalInfoValues[K]) => void;
}

const PersonalInfoTab: React.FC<PersonalInfoTabProps> = ({
  fullName,
  dob,
  gender,
  phone,
  alternatePhone,
  maritalStatus,
  hasChildren,
  numberChildren,
  errors,
  onChange,
}) => {
  const age = ageFromDob(dob);
  return (
  <div className="flex flex-col gap-5">
    <Field label="Full Name" htmlFor="fullname-input">
      <Input
        id="fullname-input"
        type="text"
        leftIcon={<User />}
        value={fullName}
        onChange={e => onChange('fullName', e.target.value)}
        required
      />
    </Field>

    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field label="Date of Birth" htmlFor="dob-input" error={errors.dob}>
        <DateInput
          id="dob-input"
          value={dob}
          error={!!errors.dob}
          onChange={v => onChange('dob', v)}
        />
      </Field>
      <Field label="Age">
        <div className="rounded-lg border border-border-strong/60 bg-surface-sunken px-3.5 py-2.5 text-sm">
          {age === '' ? <span className="text-ink-faint">Calculated from date of birth</span> : `${age} years`}
        </div>
      </Field>
    </div>

    <Field label="Gender" error={errors.gender}>
      <div className="mt-1 flex gap-4">
        {GENDERS.map(option => (
          <Radio
            key={option}
            name="gender"
            value={option}
            checked={gender === option}
            onChange={e => onChange('gender', e.target.value)}
            label={option}
          />
        ))}
      </div>
    </Field>

    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field label="Contact Phone" htmlFor="phone-input" error={errors.phone}>
        <Input
          id="phone-input"
          type="tel"
          inputMode="numeric"
          leftIcon={<Phone />}
          value={phone}
          error={!!errors.phone}
          onChange={e => onChange('phone', e.target.value)}
        />
      </Field>
      <Field label="Alternate Phone (Optional)" htmlFor="alternate-phone-input" error={errors.alternatePhone}>
        <Input
          id="alternate-phone-input"
          type="tel"
          inputMode="numeric"
          leftIcon={<Phone />}
          value={alternatePhone}
          error={!!errors.alternatePhone}
          onChange={e => onChange('alternatePhone', e.target.value)}
        />
      </Field>
    </div>

    <Field label="Marital Status" htmlFor="marital-select" error={errors.maritalStatus}>
      <Select id="marital-select" value={maritalStatus} error={!!errors.maritalStatus}
        onChange={e => onChange('maritalStatus', e.target.value)}>
        <option value="">Select marital status</option>
        {MARITAL.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </Select>
    </Field>

    <Field label="Do you have any children?" error={errors.hasChildren}>
      <div className="mt-1 flex gap-4">
        {['Yes', 'No'].map(option => (
          <Radio
            key={option}
            name="has_children"
            value={option}
            checked={hasChildren === option}
            onChange={e => onChange('hasChildren', e.target.value)}
            label={option}
          />
        ))}
      </div>
    </Field>

    {hasChildren === 'Yes' && (
      <Field label="Number of children" htmlFor="number-children-input" error={errors.numberChildren}>
        <Input
          id="number-children-input"
          type="number"
          min={0}
          placeholder="e.g. 2"
          value={numberChildren}
          error={!!errors.numberChildren}
          onChange={e => onChange('numberChildren', e.target.value ? Number(e.target.value) : '')}
        />
      </Field>
    )}
    </div>
  );
};

export default PersonalInfoTab;
