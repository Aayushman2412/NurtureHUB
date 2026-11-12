import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import { updateProject } from '../../api/projects';
import type { AdminProject } from '../../lib/adminProject';
import { Badge, Button, FieldLabel, Select } from '../ui';

const PROTOCOLS = ['lap_2026_11', 'lap_2025'] as const;
const SPLITS = [150, 180];

/**
 * Which visit schedule a project's health workers follow (November 2026,
 * docs/visit-protocol-2026-11.md), and the baby's age at adoption that splits
 * PNC adoptions. New projects start on the November 2026 protocol and 180
 * days; the projects already running stay on the earlier schedule unless
 * switched here. A district that follows its state's content follows the
 * state's protocol too, so it is shown but changed on the state.
 */
const ProjectVisitProtocolPanel: React.FC<{ project: AdminProject; onSaved: () => void }> = ({ project, onSaved }) => {
  const { t } = useTranslation('admin');
  const visit = project.visit;
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState(visit?.own_protocol ?? 'lap_2026_11');
  const [split, setSplit] = useState(visit?.own_pnc_split_days ?? 180);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!visit) return null;

  const inherited = visit.inherited_from != null;
  const splits = SPLITS.includes(split) ? SPLITS : [...SPLITS, split].sort((a, b) => a - b);
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await updateProject(project.id, { visit_protocol: protocol, pnc_split_days: split });
      setOpen(false);
      onSaved();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('projects.visit.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-sunken/50 px-3 py-2">
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 text-left text-sm"
      >
        <CalendarClock className="size-4 text-ink-muted" />
        <span className="font-semibold text-ink">{t('projects.visit.title')}</span>
        <Badge variant={visit.protocol === 'lap_2026_11' ? 'info' : 'neutral'} size="sm">
          {t(`projects.visit.protocol.${visit.protocol}`, { defaultValue: visit.protocol })}
        </Badge>
        <span className="text-xs text-ink-muted">{t('projects.visit.splitShort', { days: visit.pnc_split_days })}</span>
        <span className="ml-auto text-xs text-primary-ink">{open ? t('projects.visit.hide') : t('projects.visit.change')}</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 pb-1">
          <p className="text-xs leading-relaxed text-ink-muted">{t('projects.visit.help')}</p>
          {inherited ? (
            <p className="text-sm text-ink">{t('projects.visit.inherited', { state: visit.inherited_from })}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel size="sm" htmlFor={`protocol-${project.id}`}>{t('projects.visit.protocolLabel')}</FieldLabel>
                  <Select id={`protocol-${project.id}`} value={protocol} onChange={e => setProtocol(e.target.value)}>
                    {PROTOCOLS.map(p => <option key={p} value={p}>{t(`projects.visit.protocol.${p}`)}</option>)}
                  </Select>
                </div>
                <div>
                  <FieldLabel size="sm" htmlFor={`split-${project.id}`}>{t('projects.visit.splitLabel')}</FieldLabel>
                  <Select id={`split-${project.id}`} value={split} onChange={e => setSplit(Number(e.target.value))}>
                    {splits.map(d => <option key={d} value={d}>{t('projects.visit.splitOption', { days: d, months: Math.round(d / 30) })}</option>)}
                  </Select>
                </div>
              </div>
              <p className="text-xs text-ink-faint">{t('projects.visit.warning')}</p>
              <div>
                <Button size="sm" loading={saving} onClick={() => void save()}
                  disabled={protocol === visit.own_protocol && split === visit.own_pnc_split_days}>
                  {t('projects.visit.save')}
                </Button>
              </div>
              {error && <p className="text-xs text-error-600">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectVisitProtocolPanel;
