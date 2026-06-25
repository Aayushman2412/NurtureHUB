import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import client from '../api/client';

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
          client.get('/api/metadata/experience-ranges')
        ]);
        setStatesList(statesRes.data);
        setQualificationsList(qualificationsRes.data);
        setExperienceRangesList(experienceRes.data);
      } catch (err) {
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
      } catch (err) {
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
      } catch (err) {
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
          client.get(`/api/metadata/facilities?block_id=${selectedBlockId}`)
        ]);
        setVillagesList(villagesRes.data);
        setFacilitiesList(facilitiesRes.data);
        setSelectedVillageId('');
        setSelectedFacilityId('');
      } catch (err) {
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
    if (!selectedStateId || !selectedDistrictId || !selectedBlockId || !selectedFacilityId || !selectedVillageId || !selectedQualificationId || !selectedExperienceRangeId) {
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
        work_center_name: selectedFacilityName
      });
      showToast('Registration completed successfully! Welcome to NurtureHUB.', 'success');
      navigate('/dashboard');
    } catch (err: any) {
      showToast('Failed to save profile registration. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '0.8125rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--primary-600)',
    marginBottom: '16px',
    paddingBottom: '8px',
    borderBottom: '2px solid var(--primary-100)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  return (
    <AuthLayout
      title="Complete Registration"
      subtitle="Fill in your details below to customize your learning and assessment dashboard."
    >
      <form onSubmit={handleSubmit} className="registration-form" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

        {/* ── Section 1: Personal Details ──────────────── */}
        <div>
          <div style={sectionTitleStyle}>
            <span style={{
              width: '22px', height: '22px', borderRadius: '50%',
              backgroundColor: 'var(--primary-500)', color: 'white',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', fontWeight: 700,
            }}>1</span>
            Personal Details
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="auth-form-row-2col">
              <div className="form-group">
                <label className="form-label" htmlFor="dob-input">Date of Birth</label>
                <input
                  id="dob-input"
                  type="date"
                  className="auth-input-field"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="age-input">Age (Years)</label>
                <input
                  id="age-input"
                  type="number"
                  className="auth-input-field"
                  placeholder="e.g. 28"
                  value={age}
                  onChange={(e) => setAge(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Gender</label>
              <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                {['Female', 'Male', 'Other'].map(option => (
                  <label key={option} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="gender"
                      value={option}
                      checked={gender === option}
                      onChange={(e) => setGender(e.target.value)}
                      required
                      style={{ accentColor: 'var(--primary-500)' }}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="phone-input">Contact Number</label>
              <input
                id="phone-input"
                type="tel"
                className="auth-input-field"
                placeholder="e.g. +91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="alternate-phone-input">Alternate Contact Number (Optional)</label>
              <input
                id="alternate-phone-input"
                type="tel"
                className="auth-input-field"
                placeholder="e.g. +91 98765 43210"
                value={alternatePhone}
                onChange={(e) => setAlternatePhone(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ── Section 2: Professional Details ──────────── */}
        <div>
          <div style={sectionTitleStyle}>
            <span style={{
              width: '22px', height: '22px', borderRadius: '50%',
              backgroundColor: 'var(--primary-500)', color: 'white',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', fontWeight: 700,
            }}>2</span>
            Professional & Educational Details
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* 1. State */}
            <div className="form-group">
              <label className="form-label" htmlFor="state-select">State</label>
              <select
                id="state-select"
                className="auth-input-field"
                value={selectedStateId}
                onChange={(e) => setSelectedStateId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select State</option>
                {statesList.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* 2. District */}
            <div className="form-group">
              <label className="form-label" htmlFor="district-select">District</label>
              <select
                id="district-select"
                className="auth-input-field"
                value={selectedDistrictId}
                onChange={(e) => setSelectedDistrictId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedStateId}
              >
                <option value="">Select District</option>
                {districtsList.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* 3. Department */}
            <div className="form-group">
              <label className="form-label" htmlFor="dept-select">Department</label>
              <select
                id="dept-select"
                className="auth-input-field"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                required
              >
                <option value="Women & Child Development (WCD)">Women & Child Development (WCD)</option>
                <option value="Department of Health and Family Welfare">Department of Health & Family Welfare</option>
                <option value="National Health Mission (NHM)">National Health Mission (NHM)</option>
              </select>
            </div>

            {/* 4. Administrative Block */}
            <div className="form-group">
              <label className="form-label" htmlFor="block-select">Administrative Block</label>
              <select
                id="block-select"
                className="auth-input-field"
                value={selectedBlockId}
                onChange={(e) => setSelectedBlockId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedDistrictId}
              >
                <option value="">Select Block</option>
                {blocksList.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* 5. Type of Workplace */}
            <div className="form-group">
              <label className="form-label" htmlFor="workplace-type-select">Type of Workplace</label>
              <select
                id="workplace-type-select"
                className="auth-input-field"
                value={workCenterType}
                onChange={(e) => setWorkCenterType(e.target.value)}
                required
              >
                <option value="Anganwadi Center (AWC)">Anganwadi Center (AWC)</option>
                <option value="Mini Anganwadi Center">Mini Anganwadi Center</option>
                <option value="Sector Office">Sector Office</option>
                <option value="Project Office (CDPO)">Project Office (CDPO)</option>
                <option value="Primary Health Center (PHC)">Primary Health Center (PHC)</option>
              </select>
            </div>

            {/* 6. Facility Name */}
            <div className="form-group">
              <label className="form-label" htmlFor="facility-select">Facility Name</label>
              <select
                id="facility-select"
                className="auth-input-field"
                value={selectedFacilityId}
                onChange={(e) => setSelectedFacilityId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedBlockId}
              >
                <option value="">Select Facility</option>
                {facilitiesList.map(f => (
                  <option key={f.id} value={f.id}>{f.name} ({f.facility_type})</option>
                ))}
              </select>
            </div>

            {/* 7. City / Village */}
            <div className="form-group">
              <label className="form-label" htmlFor="village-select">Workplace Village / City</label>
              <select
                id="village-select"
                className="auth-input-field"
                value={selectedVillageId}
                onChange={(e) => setSelectedVillageId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedBlockId}
              >
                <option value="">Select Village / City</option>
                {villagesList.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>

            {/* 8. Designation / Role */}
            <div className="form-group">
              <label className="form-label" htmlFor="role-select">Designation / Role</label>
              <select
                id="role-select"
                className="auth-input-field"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                required
              >
                <option value="Anganwadi Worker">Anganwadi Worker (AWW)</option>
                <option value="Anganwadi Helper">Anganwadi Helper (AWH)</option>
                <option value="Anganwadi Supervisor">Anganwadi Supervisor</option>
                <option value="Child Development Project Officer">Child Development Project Officer (CDPO)</option>
                <option value="ANM / Health Worker">ANM / Health Worker</option>
              </select>
            </div>

            {/* 9. Highest Educational Qualification */}
            <div className="form-group">
              <label className="form-label" htmlFor="qualification-select">Highest Educational Qualification</label>
              <select
                id="qualification-select"
                className="auth-input-field"
                value={selectedQualificationId}
                onChange={(e) => setSelectedQualificationId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select Qualification</option>
                {qualificationsList.map(q => (
                  <option key={q.id} value={q.id}>{q.qualification_name}</option>
                ))}
              </select>
            </div>

            {/* Qualification - Semi-Open specification */}
            {showOtherQualificationInput && (
              <div className="form-group">
                <label className="form-label" htmlFor="qualification-other-detail">Please specify qualification</label>
                <input
                  id="qualification-other-detail"
                  type="text"
                  className="auth-input-field"
                  placeholder="Enter details..."
                  value={qualificationOtherDetail}
                  onChange={(e) => setQualificationOtherDetail(e.target.value)}
                  required
                />
              </div>
            )}

            {/* 10. Experience in current designation */}
            <div className="form-group">
              <label className="form-label" htmlFor="experience-select">Experience in Current Designation</label>
              <select
                id="experience-select"
                className="auth-input-field"
                value={selectedExperienceRangeId}
                onChange={(e) => setSelectedExperienceRangeId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                <option value="">Select Experience Range</option>
                {experienceRangesList.map(exp => (
                  <option key={exp.id} value={exp.id}>{exp.label}</option>
                ))}
              </select>
            </div>

          </div>
        </div>

        {/* ── Disclaimer + Submit ──────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '16px' }}>
            By completing this registration, your account will be unlocked for training modules, assessments, and tracking metrics.
          </p>
          <button
            type="submit"
            className="auth-primary-btn"
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Submitting...' : 'Complete Registration ✓'}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
};

export default RegistrationPage;
