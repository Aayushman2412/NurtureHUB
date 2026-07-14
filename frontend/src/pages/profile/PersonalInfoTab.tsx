import React from 'react';
import { useTranslation } from 'react-i18next';
import { User, Phone } from 'lucide-react';
import { DateInput, Field, Input, Radio, Select } from '../../components/ui';
import { genderOptions, maritalOptions, ageFromDob } from '../../lib/learnerFields';
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
  const { t } = useTranslation('learner');
  const age = ageFromDob(dob);
  return (
  <div className="flex flex-col gap-5">
    <Field label={t('fields.fullName')} htmlFor="fullname-input">
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
      <Field label={t('fields.dob')} htmlFor="dob-input" error={errors.dob}>
        <DateInput
          id="dob-input"
          value={dob}
          error={!!errors.dob}
          onChange={v => onChange('dob', v)}
        />
      </Field>
      <Field label={t('fields.age')}>
        <div className="rounded-lg border border-border-strong/60 bg-surface-sunken px-3.5 py-2.5 text-sm">
          {age === '' ? <span className="text-ink-faint">{t('fields.ageCalculated')}</span> : t('fields.ageValue', { age })}
        </div>
      </Field>
    </div>

    <Field label={t('fields.gender')} error={errors.gender}>
      <div className="mt-1 flex gap-4">
        {genderOptions(t).map(option => (
          <Radio
            key={option.value}
            name="gender"
            value={option.value}
            checked={gender === option.value}
            onChange={e => onChange('gender', e.target.value)}
            label={option.label}
          />
        ))}
      </div>
    </Field>

    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field label={t('fields.contactPhone')} htmlFor="phone-input" error={errors.phone}>
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
      <Field label={t('fields.alternatePhone')} htmlFor="alternate-phone-input" error={errors.alternatePhone}>
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

    <Field label={t('fields.maritalStatus')} htmlFor="marital-select" error={errors.maritalStatus}>
      <Select id="marital-select" value={maritalStatus} error={!!errors.maritalStatus}
        onChange={e => onChange('maritalStatus', e.target.value)}>
        <option value="">{t('placeholders.selectMarital')}</option>
        {maritalOptions(t).map(m => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </Select>
    </Field>

    <Field label={t('fields.hasChildren')} error={errors.hasChildren}>
      <div className="mt-1 flex gap-4">
        {[['Yes', t('options.yes')], ['No', t('options.no')]].map(([val, lbl]) => (
          <Radio
            key={val}
            name="has_children"
            value={val}
            checked={hasChildren === val}
            onChange={e => onChange('hasChildren', e.target.value)}
            label={lbl}
          />
        ))}
      </div>
    </Field>

    {hasChildren === 'Yes' && (
      <Field label={t('fields.numberChildren')} htmlFor="number-children-input" error={errors.numberChildren}>
        <Input
          id="number-children-input"
          type="number"
          min={0}
          placeholder={t('fields.numberChildrenPlaceholder')}
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
