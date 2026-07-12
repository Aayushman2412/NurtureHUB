import React from 'react';
import { Briefcase } from 'lucide-react';
import { Field, Input, Select } from '../../components/ui';

export interface Option {
  id: number;
  name: string;
}
export interface FacilityOption {
  id: number;
  name: string;
  facility_type: string;
}
export interface QualificationOption {
  id: number;
  qualification_name: string;
  has_semi_open_input: boolean;
}
export interface ExperienceRangeOption {
  id: number;
  label: string;
}

interface WorkDetailsTabProps {
  // values
  selectedStateId: number | '';
  selectedDistrictId: number | '';
  selectedBlockId: number | '';
  selectedVillageId: number | '';
  selectedFacilityId: number | '';
  selectedQualificationId: number | '';
  selectedExperienceRangeId: number | '';
  qualificationOtherDetail: string;
  department: string;
  role: string;
  workCenterType: string;
  showOtherQualificationInput: boolean;
  // option lists
  statesList: Option[];
  districtsList: Option[];
  blocksList: Option[];
  villagesList: Option[];
  facilitiesList: FacilityOption[];
  qualificationsList: QualificationOption[];
  experienceRangesList: ExperienceRangeOption[];
  // handlers
  onState: (v: number | '') => void;
  onDistrict: (v: number | '') => void;
  onBlock: (v: number | '') => void;
  onVillage: (v: number | '') => void;
  onFacility: (v: number | '') => void;
  onQualification: (v: number | '') => void;
  onExperience: (v: number | '') => void;
  onQualificationOther: (v: string) => void;
  onDepartment: (v: string) => void;
  onRole: (v: string) => void;
  onWorkCenterType: (v: string) => void;
}

const num = (v: string): number | '' => (v ? Number(v) : '');

const WorkDetailsTab: React.FC<WorkDetailsTabProps> = props => (
  <div className="flex flex-col gap-5">
    <Field label="State" htmlFor="state-select">
      <Select
        id="state-select"
        value={props.selectedStateId}
        onChange={e => props.onState(num(e.target.value))}
        required
      >
        <option value="">Select State</option>
        {props.statesList.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </Select>
    </Field>

    <Field label="District" htmlFor="district-select">
      <Select
        id="district-select"
        value={props.selectedDistrictId}
        onChange={e => props.onDistrict(num(e.target.value))}
        required
        disabled={!props.selectedStateId}
      >
        <option value="">Select District</option>
        {props.districtsList.map(d => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </Select>
    </Field>

    <Field label="Department" htmlFor="dept-select">
      <div className="relative">
        <Briefcase className="pointer-events-none absolute left-3.5 top-1/2 z-1 size-[18px] -translate-y-1/2 text-ink-faint" />
        <Select
          id="dept-select"
          value={props.department}
          onChange={e => props.onDepartment(e.target.value)}
          required
          className="pl-11"
        >
          <option value="Women & Child Development (WCD)">Women &amp; Child Development (WCD)</option>
          <option value="Department of Health and Family Welfare">Department of Health &amp; Family Welfare</option>
          <option value="National Health Mission (NHM)">National Health Mission (NHM)</option>
        </Select>
      </div>
    </Field>

    <Field label="Administrative Block" htmlFor="block-select">
      <Select
        id="block-select"
        value={props.selectedBlockId}
        onChange={e => props.onBlock(num(e.target.value))}
        required
        disabled={!props.selectedDistrictId}
      >
        <option value="">Select Block</option>
        {props.blocksList.map(b => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </Select>
    </Field>

    <Field label="Type of Workplace" htmlFor="workplace-type-select">
      <Select
        id="workplace-type-select"
        value={props.workCenterType}
        onChange={e => props.onWorkCenterType(e.target.value)}
        required
      >
        <option value="Anganwadi Center (AWC)">Anganwadi Center (AWC)</option>
        <option value="Mini Anganwadi Center">Mini Anganwadi Center</option>
        <option value="Sector Office">Sector Office</option>
        <option value="Project Office (CDPO)">Project Office (CDPO)</option>
        <option value="Primary Health Center (PHC)">Primary Health Center (PHC)</option>
      </Select>
    </Field>

    <Field label="Facility Name" htmlFor="facility-select">
      <Select
        id="facility-select"
        value={props.selectedFacilityId}
        onChange={e => props.onFacility(num(e.target.value))}
        required
        disabled={!props.selectedBlockId}
      >
        <option value="">Select Facility</option>
        {props.facilitiesList.map(f => (
          <option key={f.id} value={f.id}>{f.name} ({f.facility_type})</option>
        ))}
      </Select>
    </Field>

    <Field label="Workplace Village / City" htmlFor="village-select">
      <Select
        id="village-select"
        value={props.selectedVillageId}
        onChange={e => props.onVillage(num(e.target.value))}
        required
        disabled={!props.selectedBlockId}
      >
        <option value="">Select Village / City</option>
        {props.villagesList.map(v => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </Select>
    </Field>

    <Field label="Designation / Role" htmlFor="role-select">
      <Select id="role-select" value={props.role} onChange={e => props.onRole(e.target.value)} required>
        <option value="Anganwadi Worker">Anganwadi Worker (AWW)</option>
        <option value="Anganwadi Helper">Anganwadi Helper (AWH)</option>
        <option value="Anganwadi Supervisor">Anganwadi Supervisor</option>
        <option value="Child Development Project Officer">Child Development Project Officer (CDPO)</option>
        <option value="ANM / Health Worker">ANM / Health Worker</option>
      </Select>
    </Field>

    <Field label="Highest Educational Qualification" htmlFor="qualification-select">
      <Select
        id="qualification-select"
        value={props.selectedQualificationId}
        onChange={e => props.onQualification(num(e.target.value))}
        required
      >
        <option value="">Select Qualification</option>
        {props.qualificationsList.map(q => (
          <option key={q.id} value={q.id}>{q.qualification_name}</option>
        ))}
      </Select>
    </Field>

    {props.showOtherQualificationInput && (
      <Field label="Please specify qualification" htmlFor="qualification-other-detail">
        <Input
          id="qualification-other-detail"
          type="text"
          placeholder="Enter details..."
          value={props.qualificationOtherDetail}
          onChange={e => props.onQualificationOther(e.target.value)}
          required
        />
      </Field>
    )}

    <Field label="Experience in Current Designation" htmlFor="experience-select">
      <Select
        id="experience-select"
        value={props.selectedExperienceRangeId}
        onChange={e => props.onExperience(num(e.target.value))}
        required
      >
        <option value="">Select Experience Range</option>
        {props.experienceRangesList.map(exp => (
          <option key={exp.id} value={exp.id}>{exp.label}</option>
        ))}
      </Select>
    </Field>
  </div>
);

export default WorkDetailsTab;
