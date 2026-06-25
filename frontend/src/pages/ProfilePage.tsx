import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Phone, Briefcase, Calendar } from 'lucide-react';
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

const ProfilePage: React.FC = () => {
  const { user, updateProfile } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'personal' | 'professional'>('personal');
  const [loading, setLoading] = useState(false);

  // Form states
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [age, setAge] = useState<number | ''>(user?.age || '');
  const [dob, setDob] = useState(user?.date_of_birth || '');
  const [gender, setGender] = useState(user?.gender || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [alternatePhone, setAlternatePhone] = useState(user?.alternate_phone || '');
  const [department, setDepartment] = useState(user?.department || 'Women & Child Development (WCD)');
  const [role, setRole] = useState(user?.role || 'Anganwadi Worker');
  const [workCenterType, setWorkCenterType] = useState(user?.work_center_type || 'Anganwadi Center (AWC)');

  // API Options List States
  const [statesList, setStatesList] = useState<StateOption[]>([]);
  const [districtsList, setDistrictsList] = useState<DistrictOption[]>([]);
  const [blocksList, setBlocksList] = useState<BlockOption[]>([]);
  const [villagesList, setVillagesList] = useState<VillageOption[]>([]);
  const [facilitiesList, setFacilitiesList] = useState<FacilityOption[]>([]);
  const [qualificationsList, setQualificationsList] = useState<QualificationOption[]>([]);
  const [experienceRangesList, setExperienceRangesList] = useState<ExperienceRangeOption[]>([]);

  // Selected Option States (Foreign Key IDs)
  const [selectedStateId, setSelectedStateId] = useState<number | ''>(user?.state_id || '');
  const [selectedDistrictId, setSelectedDistrictId] = useState<number | ''>(user?.district_id || '');
  const [selectedBlockId, setSelectedBlockId] = useState<number | ''>(user?.block_id || '');
  const [selectedVillageId, setSelectedVillageId] = useState<number | ''>(user?.village_id || '');
  const [selectedFacilityId, setSelectedFacilityId] = useState<number | ''>(user?.facility_id || '');
  const [selectedQualificationId, setSelectedQualificationId] = useState<number | ''>(user?.qualification_id || '');
  const [selectedExperienceRangeId, setSelectedExperienceRangeId] = useState<number | ''>(user?.experience_range_id || '');
  const [qualificationOtherDetail, setQualificationOtherDetail] = useState(user?.qualification_other_detail || '');

  // Sync form state when user changes
  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setAge(user.age || '');
      setDob(user.date_of_birth || '');
      setGender(user.gender || '');
      setPhone(user.phone || '');
      setAlternatePhone(user.alternate_phone || '');
      setDepartment(user.department || 'Women & Child Development (WCD)');
      setRole(user.role || 'Anganwadi Worker');
      setWorkCenterType(user.work_center_type || 'Anganwadi Center (AWC)');
      setSelectedStateId(user.state_id || '');
      setSelectedDistrictId(user.district_id || '');
      setSelectedBlockId(user.block_id || '');
      setSelectedVillageId(user.village_id || '');
      setSelectedFacilityId(user.facility_id || '');
      setSelectedQualificationId(user.qualification_id || '');
      setSelectedExperienceRangeId(user.experience_range_id || '');
      setQualificationOtherDetail(user.qualification_other_detail || '');
    }
  }, [user]);

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
      return;
    }
    const fetchDistricts = async () => {
      try {
        const res = await client.get(`/api/metadata/districts?state_id=${selectedStateId}`);
        setDistrictsList(res.data);
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
      return;
    }
    const fetchBlocks = async () => {
      try {
        const res = await client.get(`/api/metadata/blocks?district_id=${selectedDistrictId}`);
        setBlocksList(res.data);
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

    if (!selectedStateId || !selectedDistrictId || !selectedBlockId || !selectedFacilityId || !selectedVillageId || !selectedQualificationId || !selectedExperienceRangeId) {
      showToast('Please fill in all professional and educational details', 'warning');
      return;
    }

    setLoading(true);
    showToast('Saving profile updates...', 'info');

    try {
      const selectedDistrict = districtsList.find(d => d.id === Number(selectedDistrictId))?.name || user?.district_rel?.name || null;
      const selectedFacilityName = facilitiesList.find(f => f.id === Number(selectedFacilityId))?.name || user?.facility?.name || null;
      const selectedFacilityType = facilitiesList.find(f => f.id === Number(selectedFacilityId))?.facility_type || user?.facility?.facility_type || null;

      await updateProfile({
        full_name: fullName,
        age: age ? Number(age) : null,
        date_of_birth: dob ? dob : null,
        gender: gender || null,
        phone: phone || null,
        alternate_phone: alternatePhone || null,
        state_id: Number(selectedStateId),
        district_id: Number(selectedDistrictId),
        block_id: Number(selectedBlockId),
        village_id: Number(selectedVillageId),
        facility_id: Number(selectedFacilityId),
        qualification_id: Number(selectedQualificationId),
        experience_range_id: Number(selectedExperienceRangeId),
        qualification_other_detail: showOtherQualificationInput ? qualificationOtherDetail : null,
        department,
        role,
        work_center_type: selectedFacilityType || workCenterType,
        // Legacy fields backward compatibility
        district: selectedDistrict,
        work_center_name: selectedFacilityName
      });
      showToast('Profile updated successfully!', 'success');
    } catch (err: any) {
      showToast('Failed to update profile details', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* Profile Header Card */}
      <div 
        className="card" 
        style={{ 
          padding: '32px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '24px', 
          flexWrap: 'wrap',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)' 
        }}
      >
        <div 
          className="avatar avatar-lg font-display" 
          style={{ 
            width: '80px', 
            height: '80px', 
            fontSize: '2rem', 
            boxShadow: '0 0 0 4px var(--primary-100)',
            backgroundColor: 'var(--primary-500)',
            color: 'white'
          }}
        >
          {user?.avatar_initials || 'U'}
        </div>

        <div style={{ flex: 1 }}>
          <h2 className="font-display" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
            {user?.full_name || 'Healthcare Professional'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 12px 0' }}>
            {user?.role || 'ICDS Worker'} • {user?.work_center_name || 'AWC Center'}
          </p>
          <div style={{ display: 'flex', gap: '24px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            <span>Email: <strong>{user?.email}</strong></span>
            <span>Joined: <strong>{user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</strong></span>
          </div>
        </div>
      </div>

      {/* Main Settings Tabs and Forms */}
      <div className="card" style={{ padding: 0 }}>
        {/* Navigation Tabs */}
        <div 
          style={{ 
            display: 'flex', 
            borderBottom: '1px solid var(--border-color)', 
            padding: '0 20px',
            backgroundColor: 'var(--bg-primary)',
            borderTopLeftRadius: 'var(--radius-lg)',
            borderTopRightRadius: 'var(--radius-lg)' 
          }}
        >
          <button
            onClick={() => setActiveTab('personal')}
            className={`tab-item ${activeTab === 'personal' ? 'active' : ''}`}
            style={{
              padding: '16px 20px',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              background: 'none',
              color: activeTab === 'personal' ? 'var(--primary-600)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'personal' ? '2px solid var(--primary-500)' : '2px solid transparent',
              cursor: 'pointer'
            }}
          >
            Personal Details
          </button>
          <button
            onClick={() => setActiveTab('professional')}
            className={`tab-item ${activeTab === 'professional' ? 'active' : ''}`}
            style={{
              padding: '16px 20px',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              background: 'none',
              color: activeTab === 'professional' ? 'var(--primary-600)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'professional' ? '2px solid var(--primary-500)' : '2px solid transparent',
              cursor: 'pointer'
            }}
          >
            Professional Info
          </button>
        </div>

        {/* Forms Content */}
        <form onSubmit={handleSubmit} style={{ padding: '32px' }}>
          {activeTab === 'personal' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="fullname-input">Full Name</label>
                <div style={{ position: 'relative' }}>
                  <User size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="fullname-input"
                    type="text"
                    className="form-input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    style={{ paddingLeft: '44px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="dob-input">Date of Birth</label>
                  <div style={{ position: 'relative' }}>
                    <Calendar size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="dob-input"
                      type="date"
                      className="form-input"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      required
                      style={{ paddingLeft: '44px' }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="age-input">Age</label>
                  <input
                    id="age-input"
                    type="number"
                    className="form-input"
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
                <label className="form-label" htmlFor="phone-input">Contact Phone</label>
                <div style={{ position: 'relative' }}>
                  <Phone size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="phone-input"
                    type="tel"
                    className="form-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    style={{ paddingLeft: '44px' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="alternate-phone-input">Alternate Phone (Optional)</label>
                <div style={{ position: 'relative' }}>
                  <Phone size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="alternate-phone-input"
                    type="tel"
                    className="form-input"
                    value={alternatePhone}
                    onChange={(e) => setAlternatePhone(e.target.value)}
                    style={{ paddingLeft: '44px' }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* 1. State */}
              <div className="form-group">
                <label className="form-label" htmlFor="state-select">State</label>
                <select
                  id="state-select"
                  className="form-select"
                  value={selectedStateId}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : '';
                    setSelectedStateId(val);
                    setSelectedDistrictId('');
                    setSelectedBlockId('');
                    setSelectedVillageId('');
                    setSelectedFacilityId('');
                  }}
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
                  className="form-select"
                  value={selectedDistrictId}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : '';
                    setSelectedDistrictId(val);
                    setSelectedBlockId('');
                    setSelectedVillageId('');
                    setSelectedFacilityId('');
                  }}
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
                <div style={{ position: 'relative' }}>
                  <Briefcase size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <select
                    id="dept-select"
                    className="form-select"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    style={{ paddingLeft: '44px' }}
                    required
                  >
                    <option value="Women & Child Development (WCD)">Women & Child Development (WCD)</option>
                    <option value="Department of Health and Family Welfare">Department of Health & Family Welfare</option>
                    <option value="National Health Mission (NHM)">National Health Mission (NHM)</option>
                  </select>
                </div>
              </div>

              {/* 4. Administrative Block */}
              <div className="form-group">
                <label className="form-label" htmlFor="block-select">Administrative Block</label>
                <select
                  id="block-select"
                  className="form-select"
                  value={selectedBlockId}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : '';
                    setSelectedBlockId(val);
                    setSelectedVillageId('');
                    setSelectedFacilityId('');
                  }}
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
                  className="form-select"
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
                  className="form-select"
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
                  className="form-select"
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
                  className="form-select"
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
                  className="form-select"
                  value={selectedQualificationId}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : '';
                    setSelectedQualificationId(val);
                  }}
                  required
                >
                  <option value="">Select Qualification</option>
                  {qualificationsList.map(q => (
                    <option key={q.id} value={q.id}>{q.qualification_name}</option>
                  ))}
                </select>
              </div>

              {/* Qualification - Semi-Open detail */}
              {showOtherQualificationInput && (
                <div className="form-group">
                  <label className="form-label" htmlFor="qualification-other-detail">Please specify qualification</label>
                  <input
                    id="qualification-other-detail"
                    type="text"
                    className="form-input"
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
                  className="form-select"
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
          )}

          {/* Action Row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', marginTop: '32px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ padding: '12px 30px', fontWeight: 600, cursor: 'pointer' }}
            >
              {loading ? 'Saving...' : 'Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
};

export default ProfilePage;
