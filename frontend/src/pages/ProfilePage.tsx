import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Briefcase, GraduationCap, KeyRound } from 'lucide-react';
import { Avatar, Button, Card, Tabs } from '../components/ui';
import InstallAppButton from '../components/layout/InstallAppButton';
import { useLearnerMetadata } from '../hooks/useLearnerMetadata';
import { TRAINING_KEYS, ageFromDob } from '../lib/learnerFields';
import { validateLearner, LR_STEP_FIELDS, type LearnerFormValues } from '../lib/learnerSchema';
import type { FieldErrors } from '../lib/validation';
import PersonalInfoTab, { type PersonalInfoValues } from './profile/PersonalInfoTab';
import WorkDetailsTab, { type WorkDetailsValues } from './profile/WorkDetailsTab';
import AccountTab from './profile/AccountTab';

type TabKey = 'personal' | 'work' | 'education' | 'account';
const TAB_KEYS: TabKey[] = ['personal', 'work', 'education', 'account'];
// Which tab holds a field — so a save with errors opens the right one.
const PERSONAL_KEYS = new Set([...LR_STEP_FIELDS[0]!, 'maritalStatus', 'hasChildren', 'numberChildren']);
const WORK_KEYS = new Set(LR_STEP_FIELDS[1]);

const emptyPersonal: PersonalInfoValues = {
  fullName: '', dob: '', gender: '', phone: '', alternatePhone: '',
  maritalStatus: '', hasChildren: '', numberChildren: '',
};

const emptyWork: WorkDetailsValues = {
  departmentId: '', departmentOther: '', designationId: '', designationOther: '',
  facilityTypeId: '', facilityTypeOther: '',
  stateId: '', districtId: '', blockId: '', villageId: '', villageName: '', gpId: '', gpName: '',
  facilityId: '', facilityName: '',
  residenceDistance: '', qualificationId: '', qualificationOther: '',
  yearsService: '', yearsDesignation: '', yearsFacility: '', internetWorkplace: '',
  trainings: {},
};

const ProfilePage: React.FC = () => {
  const { t } = useTranslation('learner');
  const { user, updateProfile } = useAuth();
  const { showToast, updateToast } = useToast();

  // Four tabs (review of 17 Oct 2026): one "Professional info" tab hid the
  // education and training sections below a long scroll.
  const [params] = useSearchParams();
  const initialTab = TAB_KEYS.find(k => k === params.get('tab')) ?? 'personal';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
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
      designationOther: user.designation_other || '',
      facilityTypeId: user.facility_type_id ?? '',
      facilityTypeOther: user.facility_type_other || '',
      stateId: user.state_id ?? '',
      districtId: user.district_id ?? '',
      blockId: user.block_id ?? '',
      villageId: user.village_id ?? '',
      villageName: user.village_name || '',
      gpId: user.gram_panchayat_id ?? '',
      gpName: user.gram_panchayat?.name || user.gram_panchayat_name || '',
      facilityId: user.facility_id ?? '',
      facilityName: user.work_center_name || '',
      residenceDistance: user.residence_distance_km ?? '',
      qualificationId: user.qualification_id ?? '',
      qualificationOther: user.qualification_other_detail || '',
      yearsService: user.years_service ?? '',
      yearsDesignation: user.years_designation ?? '',
      yearsFacility: user.years_facility ?? '',
      internetWorkplace: user.internet_workplace || '',
      trainings: Object.fromEntries(
        TRAINING_KEYS.map(key => [key, (user as unknown as Record<string, unknown>)[key] as string || '']),
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

  // Same for a known facility (id) without a stored name.
  useEffect(() => {
    if (work.facilityId && !work.facilityName) {
      const f = meta.facilities.find(opt => opt.id === Number(work.facilityId));
      if (f) setWork(w => ({ ...w, facilityName: f.name }));
    }
  }, [meta.facilities, work.facilityId, work.facilityName]);

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
    setWork(w => ({
      ...w, departmentId: numOr(v), designationId: '', designationOther: '',
      facilityTypeId: '', facilityTypeOther: '', qualificationId: '',
    }));
    clearError('departmentId');
  };
  const onDesignation = (v: string) => {
    setWork(w => ({ ...w, designationId: numOr(v), designationOther: '', facilityTypeId: '', facilityTypeOther: '' }));
    clearError('designationId');
  };
  const onFacilityType = (v: string) => {
    setWork(w => ({ ...w, facilityTypeId: numOr(v), facilityTypeOther: '' }));
    clearError('facilityTypeId');
  };
  const onState = (v: string) => {
    setWork(w => ({ ...w, stateId: numOr(v), districtId: '', blockId: '', villageId: '', villageName: '', facilityId: '', facilityName: '' }));
    clearError('stateId');
  };
  const onDistrict = (v: string) => {
    setWork(w => ({ ...w, districtId: numOr(v), blockId: '', villageId: '', villageName: '', facilityId: '', facilityName: '' }));
    clearError('districtId');
  };
  const onBlock = (v: string) => {
    setWork(w => ({ ...w, blockId: numOr(v), villageId: '', villageName: '', gpId: '', gpName: '', facilityId: '', facilityName: '' }));
    clearError('blockId');
  };

  const selectedDept = meta.departments.find(d => d.id === Number(work.departmentId));
  const isOtherDept = selectedDept?.code === 'OTHER';
  const selectedDesignation = meta.designations.find(d => d.id === Number(work.designationId));
  const isOtherDesignation = selectedDesignation?.is_other ?? false;
  const selectedFacilityType = meta.facilityTypes.find(f => f.id === Number(work.facilityTypeId));
  const isOtherFacilityType = selectedFacilityType?.is_other ?? false;
  const selectedQual = meta.qualifications.find(q => q.id === Number(work.qualificationId));
  const showQualificationOther = selectedQual?.has_semi_open_input ?? false;

  const values: LearnerFormValues = {
    dob: personal.dob, age: ageFromDob(personal.dob), gender: personal.gender, phone: personal.phone,
    alternatePhone: personal.alternatePhone, maritalStatus: personal.maritalStatus,
    hasChildren: personal.hasChildren, numberChildren: personal.numberChildren,
    departmentId: work.departmentId, departmentOther: work.departmentOther,
    designationId: work.designationId, designationOther: work.designationOther,
    facilityTypeId: work.facilityTypeId, facilityTypeOther: work.facilityTypeOther,
    stateId: work.stateId, districtId: work.districtId, blockId: work.blockId,
    villageId: work.villageId, villageName: work.villageName, facilityId: work.facilityId,
    facilityName: work.facilityName, residenceDistance: work.residenceDistance,
    qualificationId: work.qualificationId, qualificationOther: work.qualificationOther,
    yearsService: work.yearsService, yearsDesignation: work.yearsDesignation, yearsFacility: work.yearsFacility,
    internetWorkplace: work.internetWorkplace, trainings: work.trainings,
    isOtherDept, isOtherDesignation, isOtherFacilityType, showQualificationOther,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errs = validateLearner(values);
    if (Object.keys(errs).length) {
      setErrors(errs);
      const keys = Object.keys(errs);
      setActiveTab(keys.some(k => PERSONAL_KEYS.has(k)) ? 'personal' : keys.some(k => WORK_KEYS.has(k)) ? 'work' : 'education');
      showToast(t('profile.toastFixFields'), 'warning');
      return;
    }

    setLoading(true);
    const toastId = showToast(t('profile.toastSaving'), 'loading');
    try {
      const districtName = meta.districts.find(d => d.id === Number(work.districtId))?.name;
      // role gates profile-complete — when dept = Other or an "Other (Specify)" row is
      // picked, the free-typed text becomes the legacy string.
      const roleName = isOtherDept || isOtherDesignation ? work.designationOther.trim() : selectedDesignation?.name;
      const facilityTypeName = isOtherDept || isOtherFacilityType
        ? work.facilityTypeOther.trim() : selectedFacilityType?.name;

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
        designation_id: isOtherDept ? null : Number(work.designationId),
        role: roleName,
        designation_other: isOtherDept || isOtherDesignation ? work.designationOther.trim() : null,
        facility_type_id: isOtherDept ? null : Number(work.facilityTypeId),
        work_center_type: facilityTypeName,
        facility_type_other: isOtherDept || isOtherFacilityType ? work.facilityTypeOther.trim() : null,
        // geography: FK + legacy string
        state_id: Number(work.stateId),
        district_id: Number(work.districtId),
        block_id: Number(work.blockId),
        village_id: work.villageId ? Number(work.villageId) : null,
        village_name: work.villageId ? null : (work.villageName || null),
        gram_panchayat_id: work.gpId ? Number(work.gpId) : null,
        gram_panchayat_name: work.gpId ? null : (work.gpName.trim() || null),
        facility_id: work.facilityId ? Number(work.facilityId) : null,
        district: districtName,
        work_center_name: work.facilityName.trim() || null,
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
      updateToast(toastId, t('profile.toastSuccess'), 'success');
    } catch {
      updateToast(toastId, t('profile.toastFail'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {/* Header */}
      <Card className="flex flex-wrap items-center gap-6 bg-gradient-to-br from-surface to-surface-sunken p-5 sm:p-8">
        <Avatar name={user?.full_name || 'U'} size="xl" className="ring-4 ring-coral-100 dark:ring-coral-500/20" />
        <div className="min-w-0 flex-1">
          <h2 className="mb-1 font-display text-2xl font-extrabold text-ink">
            {user?.full_name || t('profile.nameFallback')}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            {user?.role || t('profile.roleFallback')} • {user?.work_center_name || t('profile.centerFallback')}
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-faint">
            {/* The mobile number is how a learner signs in now (review of 17 Oct 2026). */}
            <span>
              {t('profile.mobileLabel')} <strong className="text-ink-muted">{user?.phone ? `+91 ${user.phone}` : t('profile.na')}</strong>
            </span>
            <span>
              {t('profile.emailLabel')}{' '}
              <strong className="text-ink-muted">
                {user?.email_is_placeholder ? (user.contact_email || t('profile.emailNotAdded')) : user?.email}
              </strong>
            </span>
            <span>
              {t('profile.joinedLabel')}{' '}
              <strong className="text-ink-muted">
                {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-GB') : t('profile.na')}
              </strong>
            </span>
          </div>
        </div>
        {/* Install NurtureHUB on this device (hidden once installed). */}
        <InstallAppButton className="shrink-0" />
      </Card>

      {/* Tabs + form */}
      <Card className="overflow-hidden p-0">
        <div className="bg-surface-sunken/50 px-5">
          <Tabs
            value={activeTab}
            onChange={v => setActiveTab(v)}
            items={[
              { value: 'personal', label: t('profile.tabPersonal'), icon: <User className="size-4" /> },
              { value: 'work', label: t('profile.tabWork'), icon: <Briefcase className="size-4" /> },
              { value: 'education', label: t('profile.tabEducation'), icon: <GraduationCap className="size-4" /> },
              { value: 'account', label: t('profile.tabAccount'), icon: <KeyRound className="size-4" /> },
            ]}
          />
        </div>

        {activeTab === 'account' ? (
          <div className="p-5 sm:p-8"><AccountTab /></div>
        ) : (
        <form onSubmit={handleSubmit} className="p-5 sm:p-8">
          {activeTab === 'personal' ? (
            <PersonalInfoTab {...personal} errors={errors} onChange={onPersonal} />
          ) : (
            <WorkDetailsTab
              section={activeTab === 'work' ? 'work' : 'education'}
              values={work}
              meta={meta}
              errors={errors}
              isOtherDept={isOtherDept}
              isOtherDesignation={isOtherDesignation}
              isOtherFacilityType={isOtherFacilityType}
              showQualificationOther={showQualificationOther}
              onChange={onWork}
              onDepartment={onDepartment}
              onDesignation={onDesignation}
              onFacilityType={onFacilityType}
              onState={onState}
              onDistrict={onDistrict}
              onBlock={onBlock}
            />
          )}

          <div className="mt-8 flex justify-end border-t border-border pt-5">
            <Button type="submit" size="lg" loading={loading} className="w-full sm:w-auto">
              {loading ? t('profile.saving') : t('profile.saveChanges')}
            </Button>
          </div>
        </form>
        )}
      </Card>
    </div>
  );
};

export default ProfilePage;
