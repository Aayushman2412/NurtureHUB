import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Briefcase } from 'lucide-react';
import client from '../api/client';
import { Avatar, Button, Card, Tabs } from '../components/ui';
import PersonalInfoTab from './profile/PersonalInfoTab';
import WorkDetailsTab, {
  type Option as MetaOption,
  type FacilityOption,
  type QualificationOption,
  type ExperienceRangeOption,
} from './profile/WorkDetailsTab';

const ProfilePage: React.FC = () => {
  const { user, updateProfile } = useAuth();
  const { showToast, updateToast } = useToast();

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
  const [statesList, setStatesList] = useState<MetaOption[]>([]);
  const [districtsList, setDistrictsList] = useState<MetaOption[]>([]);
  const [blocksList, setBlocksList] = useState<MetaOption[]>([]);
  const [villagesList, setVillagesList] = useState<MetaOption[]>([]);
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
  const [selectedExperienceRangeId, setSelectedExperienceRangeId] = useState<number | ''>(
    user?.experience_range_id || '',
  );
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
      return;
    }
    const fetchDistricts = async () => {
      try {
        const res = await client.get(`/api/metadata/districts?state_id=${selectedStateId}`);
        setDistrictsList(res.data);
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
      return;
    }
    const fetchBlocks = async () => {
      try {
        const res = await client.get(`/api/metadata/blocks?district_id=${selectedDistrictId}`);
        setBlocksList(res.data);
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
      } catch {
        showToast('Failed to load villages and facilities', 'error');
      }
    };
    fetchVillagesAndFacilities();
  }, [selectedBlockId]);

  const selectedQualification = qualificationsList.find(q => q.id === Number(selectedQualificationId));
  const showOtherQualificationInput = selectedQualification?.has_semi_open_input || false;

  const handlePersonalChange = (key: string, value: string | number | '') => {
    switch (key) {
      case 'fullName':
        return setFullName(value as string);
      case 'age':
        return setAge(value as number | '');
      case 'dob':
        return setDob(value as string);
      case 'gender':
        return setGender(value as string);
      case 'phone':
        return setPhone(value as string);
      case 'alternatePhone':
        return setAlternatePhone(value as string);
    }
  };

  // Cascading resets preserved from the original
  const onState = (v: number | '') => {
    setSelectedStateId(v);
    setSelectedDistrictId('');
    setSelectedBlockId('');
    setSelectedVillageId('');
    setSelectedFacilityId('');
  };
  const onDistrict = (v: number | '') => {
    setSelectedDistrictId(v);
    setSelectedBlockId('');
    setSelectedVillageId('');
    setSelectedFacilityId('');
  };
  const onBlock = (v: number | '') => {
    setSelectedBlockId(v);
    setSelectedVillageId('');
    setSelectedFacilityId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

    setLoading(true);
    const toastId = showToast('Saving profile updates...', 'loading');

    try {
      const selectedDistrict =
        districtsList.find(d => d.id === Number(selectedDistrictId))?.name || user?.district_rel?.name || null;
      const selectedFacilityName =
        facilitiesList.find(f => f.id === Number(selectedFacilityId))?.name || user?.facility?.name || null;
      const selectedFacilityType =
        facilitiesList.find(f => f.id === Number(selectedFacilityId))?.facility_type ||
        user?.facility?.facility_type ||
        null;

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
        work_center_name: selectedFacilityName,
      });
      updateToast(toastId, 'Profile updated successfully!', 'success');
    } catch {
      updateToast(toastId, 'Failed to update profile details', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {/* Header */}
      <Card className="flex flex-wrap items-center gap-6 bg-gradient-to-br from-surface to-surface-sunken p-8">
        <Avatar name={user?.full_name || 'U'} size="xl" className="ring-4 ring-coral-100 dark:ring-coral-500/20" />
        <div className="min-w-0 flex-1">
          <h2 className="mb-1 font-display text-2xl font-extrabold text-ink">
            {user?.full_name || 'Healthcare Professional'}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            {user?.role || 'ICDS Worker'} • {user?.work_center_name || 'AWC Center'}
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-faint">
            <span>
              Email: <strong className="text-ink-muted">{user?.email}</strong>
            </span>
            <span>
              Joined:{' '}
              <strong className="text-ink-muted">
                {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
              </strong>
            </span>
          </div>
        </div>
      </Card>

      {/* Tabs + form */}
      <Card className="overflow-hidden p-0">
        <div className="bg-surface-sunken/50 px-5">
          <Tabs
            value={activeTab}
            onChange={v => setActiveTab(v)}
            items={[
              { value: 'personal', label: 'Personal Details', icon: <User className="size-4" /> },
              { value: 'professional', label: 'Professional Info', icon: <Briefcase className="size-4" /> },
            ]}
          />
        </div>

        <form onSubmit={handleSubmit} className="p-8">
          {activeTab === 'personal' ? (
            <PersonalInfoTab
              fullName={fullName}
              age={age}
              dob={dob}
              gender={gender}
              phone={phone}
              alternatePhone={alternatePhone}
              onChange={handlePersonalChange}
            />
          ) : (
            <WorkDetailsTab
              selectedStateId={selectedStateId}
              selectedDistrictId={selectedDistrictId}
              selectedBlockId={selectedBlockId}
              selectedVillageId={selectedVillageId}
              selectedFacilityId={selectedFacilityId}
              selectedQualificationId={selectedQualificationId}
              selectedExperienceRangeId={selectedExperienceRangeId}
              qualificationOtherDetail={qualificationOtherDetail}
              department={department}
              role={role}
              workCenterType={workCenterType}
              showOtherQualificationInput={showOtherQualificationInput}
              statesList={statesList}
              districtsList={districtsList}
              blocksList={blocksList}
              villagesList={villagesList}
              facilitiesList={facilitiesList}
              qualificationsList={qualificationsList}
              experienceRangesList={experienceRangesList}
              onState={onState}
              onDistrict={onDistrict}
              onBlock={onBlock}
              onVillage={setSelectedVillageId}
              onFacility={setSelectedFacilityId}
              onQualification={setSelectedQualificationId}
              onExperience={setSelectedExperienceRangeId}
              onQualificationOther={setQualificationOtherDetail}
              onDepartment={setDepartment}
              onRole={setRole}
              onWorkCenterType={setWorkCenterType}
            />
          )}

          <div className="mt-8 flex justify-end border-t border-border pt-5">
            <Button type="submit" size="lg" loading={loading}>
              {loading ? 'Saving...' : 'Save Profile Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default ProfilePage;
