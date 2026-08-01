import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Edit3, KeyRound, LogOut, Save, X } from 'lucide-react';
import { adminChangePassword, adminGetProfile, adminUpdateProfile } from '../../api/admin';
import type { AdminProfile } from '../../api/admin';
import { clearAdminSession } from '../../utils/adminAuth';
import { useToast } from '../../context/ToastContext';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  PageLoader,
  PasswordInput,
} from '../../components/ui';

interface EditNameCardProps {
  fullName: string;
  onSaved: (updated: AdminProfile) => void;
}

/** Inline "edit display name" form — its own small save cycle, independent of the password form. */
const EditNameCard: React.FC<EditNameCardProps> = ({ fullName, onSaved }) => {
  const { t } = useTranslation('admin');
  const { showToast, updateToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(fullName);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setName(fullName);
    setError('');
    setEditing(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('profile.editName.errEmpty'));
      return;
    }
    setSaving(true);
    const toastId = showToast(t('profile.editName.toastSaving'), 'loading');
    try {
      const updated = await adminUpdateProfile({ full_name: trimmed });
      localStorage.setItem('nh_admin_name', updated.full_name);
      window.dispatchEvent(new Event('admin-name-changed'));
      onSaved(updated);
      setEditing(false);
      updateToast(toastId, t('profile.editName.toastSuccess'), 'success');
    } catch {
      updateToast(toastId, t('profile.editName.toastFail'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4 max-w-md p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-ink">{t('profile.editName.title')}</h3>
        {!editing && (
          <Button size="sm" variant="outline" iconLeft={<Edit3 className="size-3.5" />} onClick={startEdit}>
            {t('profile.editName.title')}
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-4">
          <Field label={t('profile.editName.label')} htmlFor="admin-name" error={error}>
            <Input
              id="admin-name"
              value={name}
              onChange={e => {
                setName(e.target.value);
                if (error) setError('');
              }}
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button size="sm" iconLeft={<Save className="size-3.5" />} loading={saving} onClick={save}>
              {t('profile.editName.save')}
            </Button>
            <Button size="sm" variant="outline" iconLeft={<X className="size-3.5" />} onClick={() => setEditing(false)}>
              {t('profile.editName.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

/** Independent "change password" form — its own fields, validation and save cycle. */
const ChangePasswordCard: React.FC = () => {
  const { t } = useTranslation('admin');
  const { showToast, updateToast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const fieldErrors: typeof errors = {};
    if (!current) fieldErrors.current = t('profile.changePassword.errCurrentRequired');
    if (next.length < 6) fieldErrors.next = t('profile.changePassword.errTooShort');
    if (next !== confirm) fieldErrors.confirm = t('profile.changePassword.errMismatch');
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setSaving(true);
    const toastId = showToast(t('profile.changePassword.toastSaving'), 'loading');
    try {
      await adminChangePassword({ current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setErrors({});
      updateToast(toastId, t('profile.changePassword.toastSuccess'), 'success');
    } catch (err: any) {
      updateToast(toastId, err.response?.data?.detail || t('profile.changePassword.toastFail'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4 max-w-md p-6">
      <h3 className="font-display text-sm font-bold text-ink">{t('profile.changePassword.title')}</h3>

      <div className="mt-4 space-y-4">
        <Field label={t('profile.changePassword.current')} htmlFor="current-password" error={errors.current}>
          <PasswordInput
            id="current-password"
            value={current}
            onChange={e => {
              setCurrent(e.target.value);
              if (errors.current) setErrors(prev => ({ ...prev, current: undefined }));
            }}
          />
        </Field>
        <Field label={t('profile.changePassword.new')} htmlFor="new-password" error={errors.next}>
          <PasswordInput
            id="new-password"
            value={next}
            onChange={e => {
              setNext(e.target.value);
              if (errors.next) setErrors(prev => ({ ...prev, next: undefined }));
            }}
          />
        </Field>
        <Field label={t('profile.changePassword.confirm')} htmlFor="confirm-password" error={errors.confirm}>
          <PasswordInput
            id="confirm-password"
            value={confirm}
            onChange={e => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors(prev => ({ ...prev, confirm: undefined }));
            }}
          />
        </Field>
      </div>

      <Button
        size="sm"
        iconLeft={<KeyRound className="size-3.5" />}
        loading={saving}
        className="mt-4"
        onClick={save}
      >
        {t('profile.changePassword.save')}
      </Button>
    </Card>
  );
};

/** Admin identity view, reached from the header avatar — editable for a real
 * DB-backed admin, read-only for the hardcoded test account. */
const AdminProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('admin');
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    adminGetProfile()
      .then(data => {
        if (cancelled) return;
        setProfile(data);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const handleLogout = () => {
    clearAdminSession();
    navigate('/login');
  };

  if (loadState === 'loading') return <PageLoader label={t('profile.loading')} />;

  if (loadState === 'error' || !profile) {
    return (
      <div className="space-y-4">
        <Alert variant="error" title={t('profile.errorTitle')}>
          {t('profile.errorBody')}
        </Alert>
        <Button variant="outline" onClick={() => setReloadTick(tick => tick + 1)}>
          {t('profile.retry')}
        </Button>
      </div>
    );
  }

  const joined = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <div>
      <PageHeader title={t('profile.title')} description={t('profile.description')} />

      <Card className="max-w-md p-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile.full_name} size="xl" />
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ink">{profile.full_name}</h2>
            <Badge variant="coral">{t('layout.superAdmin')}</Badge>
          </div>
        </div>

        <div className="mt-6 space-y-3 border-t border-border pt-4 text-sm">
          {!profile.is_hardcoded && (
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">{t('profile.email')}</span>
              <span className="font-semibold text-ink">{profile.email}</span>
            </div>
          )}
          {joined && (
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">{t('profile.joined')}</span>
              <span className="font-semibold text-ink">{joined}</span>
            </div>
          )}
        </div>

        <Button
          variant="outline"
          iconLeft={<LogOut className="size-4" />}
          className="mt-6 w-full"
          onClick={handleLogout}
        >
          {t('layout.logout')}
        </Button>
      </Card>

      {profile.is_hardcoded ? (
        <Alert variant="info" className="mt-4 max-w-md" title={t('profile.hardcodedTitle')}>
          {t('profile.hardcodedNote')}
        </Alert>
      ) : (
        <>
          <EditNameCard fullName={profile.full_name} onSaved={setProfile} />
          <ChangePasswordCard />
        </>
      )}
    </div>
  );
};

export default AdminProfilePage;
