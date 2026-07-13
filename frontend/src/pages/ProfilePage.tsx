import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Briefcase } from 'lucide-react';
import { Avatar, Button, Card, Tabs } from '../components/ui';
import { useLearnerMetadata } from '../hooks/useLearnerMetadata';
import { TRAININGS, ageFromDob } from '../lib/learnerFields';
import { validateLearner, LR_STEP_FIELDS, type LearnerFormValues } from '../lib/learnerSchema';
import type { FieldErrors } from '../lib/validation';
import PersonalInfoTab, { type PersonalInfoValues } from './profile/PersonalInfoTab';
import WorkDetailsTab, { type WorkDetailsValues } from './profile/WorkDetailsTab';

const emptyPersonal: PersonalInfoValues = {
  fullName: '', dob: '', gender: '', phone: '', alternatePhone: '',
  maritalStatus: '', hasChildren: '', numberChildren: '',
};

const emptyWork: WorkDetailsValues = {
  departmentId: '', departmentOther: '', designationId: '', facilityTypeId: '',
  stateId: '', districtId: '', blockId: '', villageId: '', villageName: '', facilityId: '',
  residenceDistance: '', qualificationId: '', qualificationOther: '',
  yearsService: '', yearsDesignation: '', yearsFacility: '', internetWorkplace: '',
  trainings: {},
};

const ProfilePage: React.FC = () => {
  const { user, updateProfile } = useAuth();
  const { showToast, updateToast } = useToast();

  const [activeTab, setActiveTab] = useState<'personal' | 'professional'>('personal');
  const [loading, setLoading] = useState(false);
  const [personal, setPersonal] = useState<PersonalInfoValues>(emptyPersonal);
  const [work, setWork] = useState<WorkDetailsValues>(emptyWork);
  const [errors, setErrors] = useState<FieldErrors>({});

  const meta = useLearnerMetadata(
    {
      departmentId: work.departmentId, designationId: work.designationId,
      stateId: work.stateId, districtId: work.districtId, blockId: work.blockId,
    },
    msg => showToast(msg, 'error'),
  );

  // Prefill both tabs from the loaded user.
  useEffect(() => {
    if (!user) return;
    setPersonal({
      fullName: user.full_name || '',
      dob: user.date_of_birth || '',
      gender: user.gender || '',
      phone: user.phone || '',
      alternatePhone: user.alternate_phone || '',
      maritalStatus: user.marital_status || '',
      hasChildren: user.has_children === null || user.has_children === undefined
        ? '' : (user.has_children ? 'Yes' : 'No'),
      numberChildren: user.number_children ?? '',
    });
    setWork({
      departmentId: user.department_id ?? '',
      departmentOther: user.department_other || '',
      designationId: user.designation_id ?? '',
      facilityTypeId: user.facility_type_id ?? '',
      stateId: user.state_id ?? '',
      districtId: user.district_id ?? '',
      blockId: user.block_id ?? '',
      villageId: user.village_id ?? '',
      villageName: user.village_name || '',
      facilityId: user.facility_id ?? '',
      residenceDistance: user.residence_distance_km ?? '',
      qualificationId: user.qualification_id ?? '',
      qualificationOther: user.qualification_other_detail || '',
      yearsService: user.years_service ?? '',
      yearsDesignation: user.years_designation ?? '',
      yearsFacility: user.years_facility ?? '',
      internetWorkplace: user.internet_workplace || '',
      trainings: Object.fromEntries(
        TRAININGS.map(t => [t.key, (user as Record<string, unknown>)[t.key] as string || '']),
      ),
    });
  }, [user]);

  // If the saved profile has a known village (id) but no free-text name yet, resolve the
  // name from the loaded options so the combobox shows it.
  useEffect(() => {
    if (work.villageId && !work.villageName) {
      const v = meta.villages.find(opt => opt.id === Number(work.villageId));
      if (v) setWork(w => ({ ...w, villageName: v.name }));
    }
  }, [meta.villages, work.villageId, work.villageName]);

  // Clears the given error key(s) as the user edits — for trainings, clears the whole group.
  const clearError = (key: string) =>
    setErrors(e => {
      const next = { ...e };
      if (key === 'trainings') {
        for (const k of Object.keys(next)) if (k.startsWith('trainings.')) delete next[k];
      } else {
        delete next[key];
      }
      return Object.keys(next).length === Object.keys(e).length ? e : next;
    });

  const onPersonal = <K extends keyof PersonalInfoValues>(key: K, value: PersonalInfoValues[K]) => {
    setPersonal(p => ({ ...p, [key]: value }));
    clearError(key as string);
  };
  const onWork = <K extends keyof WorkDetailsValues>(key: K, value: WorkDetailsValues[K]) => {
    setWork(w => ({ ...w, [key]: value }));
    clearError(key as string);
  };

  const numOr = (v: string): number | '' => (v ? Number(v) : '');
  // Cascade change handlers reset dependent selections (+ clear own error).
  const onDepartment = (v: string) => {
    setWork(w => ({ ...w, departmentId: numOr(v), designationId: '', facilityTypeId: '', qualificationId: '' }));
    clearError('departmentId');
  };
  const onDesignation = (v: string) => { setWork(w => ({ ...w, designationId: numOr(v), facilityTypeId: '' })); clearError('designationId'); };
  const onState = (v: string) => {
    setWork(w => ({ ...w, stateId: numOr(v), districtId: '', blockId: '', villageId: '', villageName: '', facilityId: '' }));
    clearError('stateId');
  };
  const onDistrict = (v: string) => {
    setWork(w => ({ ...w, districtId: numOr(v), blockId: '', villageId: '', villageName: '', facilityId: '' }));
    clearError('districtId');
  };
  const onBlock = (v: string) => { setWork(w => ({ ...w, blockId: numOr(v), villageId: '', villageName: '', facilityId: '' })); clearError('blockId'); };

  const selectedDept = meta.departments.find(d => d.id === Number(work.departmentId));
  const isOtherDept = selectedDept?.code === 'OTHER';
  const selectedQual = meta.qualifications.find(q => q.id === Number(work.qualificationId));
  const showQualificationOther = selectedQual?.has_semi_open_input ?? false;

  const values: LearnerFormValues = {
    dob: personal.dob, age: ageFromDob(personal.dob), gender: personal.gender, phone: personal.phone,
    alternatePhone: personal.alternatePhone, maritalStatus: personal.maritalStatus,
    hasChildren: personal.hasChildren, numberChildren: personal.numberChildren,
    departmentId: work.departmentId, departmentOther: work.departmentOther, designationId: work.designationId,
    facilityTypeId: work.facilityTypeId, stateId: work.stateId, districtId: work.districtId, blockId: work.blockId,
    villageId: work.villageId, villageName: work.villageName, facilityId: work.facilityId, residenceDistance: work.residenceDistance,
    qualificationId: work.qualificationId, qualificationOther: work.qualificationOther,
    yearsService: work.yearsService, yearsDesignation: work.yearsDesignation, yearsFacility: work.yearsFacility,
    internetWorkplace: work.internetWorkplace, trainings: work.trainings,
    isOtherDept, showQualificationOther,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errs = validateLearner(values);
    if (Object.keys(errs).length) {
      setErrors(errs);
      const personalKeys = new Set(LR_STEP_FIELDS[0]);
      const hasPersonalError = Object.keys(errs).some(k => personalKeys.has(k));
      setActiveTab(hasPersonalError ? 'personal' : 'professional');
      showToast('Please fix the highlighted fields.', 'warning');
      return;
    }

    setLoading(true);
    const toastId = showToast('Saving profile updates...', 'loading');
    try {
      const designationName = meta.designations.find(d => d.id === Number(work.designationId))?.name;
      const facilityTypeName = meta.facilityTypes.find(f => f.id === Number(work.facilityTypeId))?.name;
      const districtName = meta.districts.find(d => d.id === Number(work.districtId))?.name;
      const facilityName = meta.facilities.find(f => f.id === Number(work.facilityId))?.name;

      await updateProfile({
        full_name: personal.fullName,
        age: ageFromDob(personal.dob) === '' ? null : Number(ageFromDob(personal.dob)),
        date_of_birth: personal.dob || null,
        gender: personal.gender || null,
        phone: personal.phone || null,
        alternate_phone: personal.alternatePhone || null,
        marital_status: personal.maritalStatus || null,
        has_children: personal.hasChildren === '' ? null : personal.hasChildren === 'Yes',
        number_children: personal.hasChildren === 'Yes' && personal.numberChildren !== ''
          ? Number(personal.numberChildren) : null,
        // professional axis: FK + legacy string
        department_id: Number(work.departmentId),
        department: selectedDept?.name,
        department_other: isOtherDept ? work.departmentOther : null,
        designation_id: Number(work.designationId),
        role: designationName,
        facility_type_id: Number(work.facilityTypeId),
        work_center_type: facilityTypeName,
        // geography: FK + legacy string
        state_id: Number(work.stateId),
        district_id: Number(work.districtId),
        block_id: Number(work.blockId),
        village_id: work.villageId ? Number(work.villageId) : null,
        village_name: work.villageId ? null : (work.villageName || null),
        facility_id: Number(work.facilityId),
        district: districtName,
        work_center_name: facilityName,
        residence_distance_km: work.residenceDistance === '' ? null : Number(work.residenceDistance),
        // education & experience
        qualification_id: Number(work.qualificationId),
        qualification_other_detail: showQualificationOther ? work.qualificationOther : null,
        years_service: work.yearsService === '' ? null : Number(work.yearsService),
        years_designation: work.yearsDesignation === '' ? null : Number(work.yearsDesignation),
        years_facility: work.yearsFacility === '' ? null : Number(work.yearsFacility),
        internet_workplace: work.internetWorkplace || null,
        // training recency
        nutrition_training: work.trainings.nutrition_training || null,
        pregnancy_nutrition_training: work.trainings.pregnancy_nutrition_training || null,
        breastfeeding_training: work.trainings.breastfeeding_training || null,
        complementary_feeding_training: work.trainings.complementary_feeding_training || null,
        growth_monitoring_training: work.trainings.growth_monitoring_training || null,
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
            <PersonalInfoTab {...personal} errors={errors} onChange={onPersonal} />
          ) : (
            <WorkDetailsTab
              values={work}
              meta={meta}
              errors={errors}
              isOtherDept={isOtherDept}
              showQualificationOther={showQualificationOther}
              onChange={onWork}
              onDepartment={onDepartment}
              onDesignation={onDesignation}
              onState={onState}
              onDistrict={onDistrict}
              onBlock={onBlock}
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
