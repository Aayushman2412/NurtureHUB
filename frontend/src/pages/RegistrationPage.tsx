import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import client from '../api/client';
import { Button, Input, Radio, Select } from '../components/ui';

interface StateOption {
  id: number;
  name: string;
}
interface DistrictOption {
  id: number;
  state_id: number;
  name: string;
}
interface BlockOption {
  id: number;
  district_id: number;
  name: string;
}
interface VillageOption {
  id: number;
  block_id: number;
  name: string;
}
interface FacilityOption {
  id: number;
  block_id: number;
  name: string;
  facility_type: string;
}
interface QualificationOption {
  id: number;
  qualification_name: string;
  has_semi_open_input: boolean;
}
interface ExperienceRangeOption {
  id: number;
  label: string;
}

const Field: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  children,
}) => (
  <div>
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-ink">
      {label}
    </label>
    {children}
  </div>
);

const SectionTitle: React.FC<{ index: number; children: React.ReactNode }> = ({ index, children }) => (
  <div className="mb-4 flex items-center gap-2 border-b-2 border-coral-100 pb-2 text-[13px] font-bold
                  uppercase tracking-wider text-primary dark:border-coral-950">
    <span className="inline-flex size-[22px] items-center justify-center rounded-full bg-primary
                     text-xs font-bold text-primary-fg">
      {index}
    </span>
    {children}
  </div>
);

const RegistrationPage: React.FC = () => {
  const [loading, setLoading] = useState(false);

  // Form Fields State
  const [age, setAge] = useState<number | ''>('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [phone, setPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [department, setDepartment] = useState('Women & Child Development (WCD)');
  const [role, setRole] = useState('Anganwadi Worker');
  const [workCenterType, setWorkCenterType] = useState('Anganwadi Center (AWC)');

  // API Options List States
  const [statesList, setStatesList] = useState<StateOption[]>([]);
  const [districtsList, setDistrictsList] = useState<DistrictOption[]>([]);
  const [blocksList, setBlocksList] = useState<BlockOption[]>([]);
  const [villagesList, setVillagesList] = useState<VillageOption[]>([]);
  const [facilitiesList, setFacilitiesList] = useState<FacilityOption[]>([]);
  const [qualificationsList, setQualificationsList] = useState<QualificationOption[]>([]);
  const [experienceRangesList, setExperienceRangesList] = useState<ExperienceRangeOption[]>([]);

  // Selected Option States (Foreign Key IDs)
  const [selectedStateId, setSelectedStateId] = useState<number | ''>('');
  const [selectedDistrictId, setSelectedDistrictId] = useState<number | ''>('');
  const [selectedBlockId, setSelectedBlockId] = useState<number | ''>('');
  const [selectedVillageId, setSelectedVillageId] = useState<number | ''>('');
  const [selectedFacilityId, setSelectedFacilityId] = useState<number | ''>('');
  const [selectedQualificationId, setSelectedQualificationId] = useState<number | ''>('');
  const [selectedExperienceRangeId, setSelectedExperienceRangeId] = useState<number | ''>('');
  const [qualificationOtherDetail, setQualificationOtherDetail] = useState('');

  const { updateProfile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Load initial dropdown fields
  useEffect(() => {
    const fetchInitialMetadata = async () => {
      try {
        const [statesRes, qualificationsRes, experienceRes] = await Promise.all([
          client.get('/api/metadata/states'),
          client.get('/api/metadata/qualifications'),
          client.get('/api/metadata/experience-ranges'),
        ]);
        setStatesList(statesRes.data);
        setQualificationsList(qualificationsRes.data);
        setExperienceRangesList(experienceRes.data);
      } catch {
        showToast('Failed to load initial form options', 'error');
      }
    };
    fetchInitialMetadata();
  }, []);

  // Fetch Districts on State change
  useEffect(() => {
    if (!selectedStateId) {
      setDistrictsList([]);
      setSelectedDistrictId('');
      return;
    }
    const fetchDistricts = async () => {
      try {
        const res = await client.get(`/api/metadata/districts?state_id=${selectedStateId}`);
        setDistrictsList(res.data);
        setSelectedDistrictId('');
      } catch {
        showToast('Failed to load districts', 'error');
      }
    };
    fetchDistricts();
  }, [selectedStateId]);

  // Fetch Blocks on District change
  useEffect(() => {
    if (!selectedDistrictId) {
      setBlocksList([]);
      setSelectedBlockId('');
      return;
    }
    const fetchBlocks = async () => {
      try {
        const res = await client.get(`/api/metadata/blocks?district_id=${selectedDistrictId}`);
        setBlocksList(res.data);
        setSelectedBlockId('');
      } catch {
        showToast('Failed to load blocks', 'error');
      }
    };
    fetchBlocks();
  }, [selectedDistrictId]);

  // Fetch Villages & Facilities on Block change
  useEffect(() => {
    if (!selectedBlockId) {
      setVillagesList([]);
      setFacilitiesList([]);
      setSelectedVillageId('');
      setSelectedFacilityId('');
      return;
    }
    const fetchVillagesAndFacilities = async () => {
      try {
        const [villagesRes, facilitiesRes] = await Promise.all([
          client.get(`/api/metadata/villages?block_id=${selectedBlockId}`),
          client.get(`/api/metadata/facilities?block_id=${selectedBlockId}`),
        ]);
        setVillagesList(villagesRes.data);
        setFacilitiesList(facilitiesRes.data);
        setSelectedVillageId('');
        setSelectedFacilityId('');
      } catch {
        showToast('Failed to load villages and facilities', 'error');
      }
    };
    fetchVillagesAndFacilities();
  }, [selectedBlockId]);

  const selectedQualification = qualificationsList.find(q => q.id === Number(selectedQualificationId));
  const showOtherQualificationInput = selectedQualification?.has_semi_open_input || false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!dob || !gender || !phone) {
      showToast('Please fill in all personal details', 'warning');
      return;
    }
    if (
      !selectedStateId ||
      !selectedDistrictId ||
      !selectedBlockId ||
      !selectedFacilityId ||
      !selectedVillageId ||
      !selectedQualificationId ||
      !selectedExperienceRangeId
    ) {
      showToast('Please fill in all professional and educational details', 'warning');
      return;
    }
    if (showOtherQualificationInput && !qualificationOtherDetail.trim()) {
      showToast('Please specify your educational qualification', 'warning');
      return;
    }

    setLoading(true);
    showToast('Submitting profile details...', 'info');

    try {
      const selectedDistrict = districtsList.find(d => d.id === Number(selectedDistrictId))?.name || undefined;
      const selectedFacilityName = facilitiesList.find(f => f.id === Number(selectedFacilityId))?.name || undefined;

      await updateProfile({
        age: age ? Number(age) : undefined,
        date_of_birth: dob ? dob : undefined,
        gender: gender || undefined,
        phone: phone || undefined,
        alternate_phone: alternatePhone || undefined,
        state_id: Number(selectedStateId),
        district_id: Number(selectedDistrictId),
        block_id: Number(selectedBlockId),
        village_id: Number(selectedVillageId),
        facility_id: Number(selectedFacilityId),
        qualification_id: Number(selectedQualificationId),
        experience_range_id: Number(selectedExperienceRangeId),
        qualification_other_detail: showOtherQualificationInput ? qualificationOtherDetail : undefined,
        department: department || undefined,
        role: role || undefined,
        work_center_type: workCenterType || undefined,
        // Legacy fields backward compatibility
        district: selectedDistrict,
        work_center_name: selectedFacilityName,
      });
      showToast('Registration completed successfully! Welcome to NurtureHUB.', 'success');
      navigate('/dashboard');
    } catch {
      showToast('Failed to save profile registration. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Complete Registration"
      subtitle="Fill in your details below to customize your learning and assessment dashboard."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-7">
        {/* ── Section 1: Personal Details ──────────────── */}
        <div>
          <SectionTitle index={1}>Personal Details</SectionTitle>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Date of Birth" htmlFor="dob-input">
                <Input id="dob-input" type="date" value={dob} onChange={e => setDob(e.target.value)} required />
              </Field>
              <Field label="Age (Years)" htmlFor="age-input">
                <Input
                  id="age-input"
                  type="number"
                  placeholder="e.g. 28"
                  value={age}
                  onChange={e => setAge(e.target.value ? Number(e.target.value) : '')}
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
                    onChange={e => setGender(e.target.value)}
                    required
                    label={option}
                  />
                ))}
              </div>
            </Field>

            <Field label="Contact Number" htmlFor="phone-input">
              <Input
                id="phone-input"
                type="tel"
                placeholder="e.g. +91 98765 43210"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
              />
            </Field>

            <Field label="Alternate Contact Number (Optional)" htmlFor="alternate-phone-input">
              <Input
                id="alternate-phone-input"
                type="tel"
                placeholder="e.g. +91 98765 43210"
                value={alternatePhone}
                onChange={e => setAlternatePhone(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* ── Section 2: Professional Details ──────────── */}
        <div>
          <SectionTitle index={2}>Professional &amp; Educational Details</SectionTitle>
          <div className="flex flex-col gap-4">
            <Field label="State" htmlFor="state-select">
              <Select
                id="state-select"
                value={selectedStateId}
                onChange={e => setSelectedStateId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select State</option>
                {statesList.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="District" htmlFor="district-select">
              <Select
                id="district-select"
                value={selectedDistrictId}
                onChange={e => setSelectedDistrictId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedStateId}
              >
                <option value="">Select District</option>
                {districtsList.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Department" htmlFor="dept-select">
              <Select id="dept-select" value={department} onChange={e => setDepartment(e.target.value)} required>
                <option value="Women & Child Development (WCD)">Women &amp; Child Development (WCD)</option>
                <option value="Department of Health and Family Welfare">Department of Health &amp; Family Welfare</option>
                <option value="National Health Mission (NHM)">National Health Mission (NHM)</option>
              </Select>
            </Field>

            <Field label="Administrative Block" htmlFor="block-select">
              <Select
                id="block-select"
                value={selectedBlockId}
                onChange={e => setSelectedBlockId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedDistrictId}
              >
                <option value="">Select Block</option>
                {blocksList.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Type of Workplace" htmlFor="workplace-type-select">
              <Select
                id="workplace-type-select"
                value={workCenterType}
                onChange={e => setWorkCenterType(e.target.value)}
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
                value={selectedFacilityId}
                onChange={e => setSelectedFacilityId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedBlockId}
              >
                <option value="">Select Facility</option>
                {facilitiesList.map(f => (
                  <option key={f.id} value={f.id}>{f.name} ({f.facility_type})</option>
                ))}
              </Select>
            </Field>

            <Field label="Workplace Village / City" htmlFor="village-select">
              <Select
                id="village-select"
                value={selectedVillageId}
                onChange={e => setSelectedVillageId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedBlockId}
              >
                <option value="">Select Village / City</option>
                {villagesList.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Designation / Role" htmlFor="role-select">
              <Select id="role-select" value={role} onChange={e => setRole(e.target.value)} required>
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
                value={selectedQualificationId}
                onChange={e => setSelectedQualificationId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select Qualification</option>
                {qualificationsList.map(q => (
                  <option key={q.id} value={q.id}>{q.qualification_name}</option>
                ))}
              </Select>
            </Field>

            {showOtherQualificationInput && (
              <Field label="Please specify qualification" htmlFor="qualification-other-detail">
                <Input
                  id="qualification-other-detail"
                  type="text"
                  placeholder="Enter details..."
                  value={qualificationOtherDetail}
                  onChange={e => setQualificationOtherDetail(e.target.value)}
                  required
                />
              </Field>
            )}

            <Field label="Experience in Current Designation" htmlFor="experience-select">
              <Select
                id="experience-select"
                value={selectedExperienceRangeId}
                onChange={e => setSelectedExperienceRangeId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select Experience Range</option>
                {experienceRangesList.map(exp => (
                  <option key={exp.id} value={exp.id}>{exp.label}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {/* ── Disclaimer + Submit ──────────────────────── */}
        <div className="border-t border-border pt-5">
          <p className="mb-4 text-center text-xs text-ink-faint">
            By completing this registration, your account will be unlocked for training modules,
            assessments, and tracking metrics.
          </p>
          <Button type="submit" size="lg" fullWidth loading={loading}>
            {loading ? 'Submitting...' : 'Complete Registration ✓'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
};

export default RegistrationPage;
