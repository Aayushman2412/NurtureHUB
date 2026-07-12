import React from 'react';
import { User, Phone, Calendar } from 'lucide-react';
import { Field, Input, Radio } from '../../components/ui';

export interface PersonalInfoValues {
  fullName: string;
  age: number | '';
  dob: string;
  gender: string;
  phone: string;
  alternatePhone: string;
}

interface PersonalInfoTabProps extends PersonalInfoValues {
  onChange: <K extends keyof PersonalInfoValues>(key: K, value: PersonalInfoValues[K]) => void;
}

const PersonalInfoTab: React.FC<PersonalInfoTabProps> = ({
  fullName,
  age,
  dob,
  gender,
  phone,
  alternatePhone,
  onChange,
}) => (
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
      <Field label="Date of Birth" htmlFor="dob-input">
        <Input
          id="dob-input"
          type="date"
          leftIcon={<Calendar />}
          value={dob}
          onChange={e => onChange('dob', e.target.value)}
          required
        />
      </Field>
      <Field label="Age" htmlFor="age-input">
        <Input
          id="age-input"
          type="number"
          value={age}
          onChange={e => onChange('age', e.target.value ? Number(e.target.value) : '')}
        />
      </Field>
    </div>

    <Field label="Gender">
      <div className="mt-1 flex gap-4">
        {['Female', 'Male', 'Other'].map(option => (
          <Radio
            key={option}
            name="gender"
            value={option}
            checked={gender === option}
            onChange={e => onChange('gender', e.target.value)}
            required
            label={option}
          />
        ))}
      </div>
    </Field>

    <Field label="Contact Phone" htmlFor="phone-input">
      <Input
        id="phone-input"
        type="tel"
        leftIcon={<Phone />}
        value={phone}
        onChange={e => onChange('phone', e.target.value)}
        required
      />
    </Field>

    <Field label="Alternate Phone (Optional)" htmlFor="alternate-phone-input">
      <Input
        id="alternate-phone-input"
        type="tel"
        leftIcon={<Phone />}
        value={alternatePhone}
        onChange={e => onChange('alternatePhone', e.target.value)}
      />
    </Field>
  </div>
);

export default PersonalInfoTab;
