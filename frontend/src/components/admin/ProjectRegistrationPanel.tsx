import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, DoorClosed, DoorOpen, UserPlus } from 'lucide-react';
import client from '../../api/client';
import { putProjectRegistration } from '../../api/registration';
import type { AdminProject } from '../../lib/adminProject';
import { Badge, Button, Select } from '../ui';

interface Place { id: number; name: string; state_id?: number }

/**
 * Where a project's learners register, and whether its registration is open
 * (review of 17 Oct 2026: "if I tell you tomorrow is the registration for
 * Chandrapur, restrict all the options in the registration page only to
 * Chandrapur"). While a project is open, the registration form offers only
 * the open projects' places; its own link locks the state and district.
 */
const ProjectRegistrationPanel: React.FC<{ project: AdminProject; onSaved: () => void }> = ({ project, onSaved }) => {
  const { t } = useTranslation('admin');
  const reg = project.registration;
  const [open, setOpen] = useState(false);
  const [stateId, setStateId] = useState<number | ''>(reg?.state_id ?? '');
  const [districtId, setDistrictId] = useState<number | ''>(reg?.district_id ?? '');
  const [states, setStates] = useState<Place[]>([]);
  const [districts, setDistricts] = useState<Place[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${reg?.link_path ?? `/join/${project.slug}`}`;

  useEffect(() => {
    if (!open) return;
    client.get<Place[]>('/api/metadata/states').then(r => setStates(r.data)).catch(() => {});
  }, [open]);
  useEffect(() => {
    if (!open || !stateId) { setDistricts([]); return; }
    client.get<Place[]>('/api/metadata/districts', { params: { state_id: stateId } })
      .then(r => setDistricts(r.data)).catch(() => {});
  }, [open, stateId]);

  const save = async (nextOpen: boolean) => {
    setSaving(true);
    setError('');
    try {
      await putProjectRegistration(project.id, {
        open: nextOpen, state_id: stateId || null, district_id: districtId || null,
      });
      onSaved();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('projects.registration.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* the link is on screen to copy by hand */ }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-sunken/50 px-3 py-2">
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 text-left text-sm"
      >
        <UserPlus className="size-4 text-ink-muted" />
        <span className="font-semibold text-ink">{t('projects.registration.title')}</span>
        {reg?.open
          ? <Badge variant="success" size="sm"><DoorOpen className="mr-1 size-3" />{t('projects.registration.open')}</Badge>
          : <Badge variant="neutral" size="sm"><DoorClosed className="mr-1 size-3" />{t('projects.registration.closed')}</Badge>}
        <span className="ml-auto text-xs text-primary-ink">{open ? t('projects.registration.hide') : t('projects.registration.manage')}</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 pb-1">
          <p className="text-xs leading-relaxed text-ink-muted">{t('projects.registration.help')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={stateId} onChange={e => { setStateId(e.target.value ? Number(e.target.value) : ''); setDistrictId(''); }}
              aria-label={t('projects.registration.state')}>
              <option value="">{t('projects.registration.state')}</option>
              {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select value={districtId} onChange={e => setDistrictId(e.target.value ? Number(e.target.value) : '')}
              disabled={!stateId} aria-label={t('projects.registration.district')}>
              <option value="">{t('projects.registration.district')}</option>
              {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reg?.open ? (
              <>
                <Button size="sm" variant="outline" loading={saving} onClick={() => void save(true)}>{t('projects.registration.savePlace')}</Button>
                <Button size="sm" variant="ghost" loading={saving} onClick={() => void save(false)}
                  iconLeft={<DoorClosed className="size-3.5" />}>{t('projects.registration.close')}</Button>
              </>
            ) : (
              <Button size="sm" loading={saving} disabled={!districtId} onClick={() => void save(true)}
                iconLeft={<DoorOpen className="size-3.5" />}>{t('projects.registration.openIt')}</Button>
            )}
          </div>
          {error && <p className="text-xs text-error-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-muted">{t('projects.registration.link')}</span>
            <code className="break-all rounded bg-surface px-1.5 py-0.5 text-ink">{link}</code>
            <Button size="sm" variant="ghost" onClick={() => void copy()}
              iconLeft={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}>
              {copied ? t('projects.registration.copied') : t('projects.registration.copy')}
            </Button>
          </div>
          {!reg?.open && <p className="text-xs text-ink-faint">{t('projects.registration.linkClosedNote')}</p>}
        </div>
      )}
    </div>
  );
};

export default ProjectRegistrationPanel;
