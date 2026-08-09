import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Trash2, Edit3, Save, X, MapPin, Users, CheckCircle2, Building2, Link2,
} from 'lucide-react';
import {
  Badge, Button, Card, Checkbox, EmptyState, FieldLabel, Input, Modal, PageHeader,
  PageLoader, Select,
} from '../../components/ui';
import {
  createProject, deleteProject, groupProjects, listProjects, updateProject,
  type ProjectGroups,
} from '../../api/projects';
import { PROJECT_EVENT, type AdminProject } from '../../lib/adminProject';
import { cn } from '../../utils/cn';

type AddMode = { level: 'state' } | { level: 'district'; parentId: number | null; parentName?: string };

/**
 * Projects = the districts and states the program runs in.
 *
 * A state project contains district projects; each of those is a full project
 * (own phases, tests and form versions) unless it is set to inherit the
 * state's content. Crosstabs analyse a district by block and a state by district.
 */
const AdminProjectsPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const [groups, setGroups] = useState<ProjectGroups>({ states: [], standalone: [], flat: [] });
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  // Add-project form
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [inherits, setInherits] = useState(false);
  const [code, setCode] = useState('');
  const [statePrefix, setStatePrefix] = useState('');
  const [formError, setFormError] = useState('');

  const load = () => {
    listProjects()
      .then(list => setGroups(groupProjects(list)))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const announce = () => {
    load();
    window.dispatchEvent(new Event(PROJECT_EVENT));
  };

  const openAdd = (mode: AddMode) => {
    setAddMode(mode);
    setName('');
    setCode('');
    setStatePrefix('');
    setInherits(false);
    setFormError('');
    setParentId(mode.level === 'district' && mode.parentId ? String(mode.parentId) : '');
  };

  const handleAdd = async () => {
    if (!addMode) return;
    if (!name.trim()) {
      setFormError(t('projects.errNameRequired'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await createProject({
        name: name.trim(),
        // Always explicit: an omitted level must never silently create a state.
        level: addMode.level,
        parent_id: addMode.level === 'district' && parentId ? Number(parentId) : null,
        inherits_content: addMode.level === 'district' && !!parentId ? inherits : false,
        code: code.trim().toUpperCase() || null,
        state_prefix: statePrefix.trim().toUpperCase() || null,
      });
      setAddMode(null);
      announce();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(detail || t('projects.errCreate'));
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (project: AdminProject) => {
    if (!editName.trim()) return;
    try {
      await updateProject(project.id, { name: editName.trim() });
      setEditingId(null);
      announce();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || t('projects.errUpdate'));
    }
  };

  const handleToggleInherit = async (project: AdminProject) => {
    try {
      await updateProject(project.id, { inherits_content: !project.inherits_content });
      announce();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || t('projects.errUpdate'));
    }
  };

  const handleDelete = async (project: AdminProject) => {
    if (!window.confirm(t('projects.confirmDelete', { name: project.name }))) return;
    try {
      await deleteProject(project.id);
      announce();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || t('projects.errDelete'));
    }
  };

  if (loading) return <PageLoader label={t('projects.loading')} />;

  const card = (project: AdminProject, nested: boolean) => (
    <Card key={project.id} className={cn('p-4', nested && 'border-dashed')}>
      <div className="flex items-start gap-3">
        <span className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          project.level === 'state'
            ? 'bg-coral-100 text-coral-700 dark:bg-coral-500/15 dark:text-coral-300'
            : 'bg-surface-sunken text-ink-muted',
        )}>
          {project.level === 'state' ? <Building2 className="size-4.5" /> : <MapPin className="size-4.5" />}
        </span>

        <div className="min-w-0 flex-1">
          {editingId === project.id ? (
            <div className="flex items-center gap-2">
              <Input value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
              <Button size="sm" iconLeft={<Save className="size-3.5" />} onClick={() => void handleRename(project)}>
                {t('projects.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display font-bold text-ink">{project.name}</span>
                <Badge variant={project.level === 'state' ? 'coral' : 'neutral'} size="sm">
                  {t(project.level === 'state' ? 'projects.levelState' : 'projects.levelDistrict')}
                </Badge>
                {project.code && (
                  <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                    {project.code}
                  </span>
                )}
                {project.inherits_content && (
                  <Badge variant="warning" size="sm">
                    <Link2 className="mr-1 size-3" />{t('projects.inherits')}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" />{t('projects.users', { n: project.user_count ?? 0 })}
                </span>
                <span>{t('projects.analysisBy', {
                  unit: t(project.level === 'state' ? 'projects.byDistrict' : 'projects.byBlock'),
                })}</span>
                {project.is_active && (
                  <span className="flex items-center gap-1 text-success-600 dark:text-success-400">
                    <CheckCircle2 className="size-3.5" />{t('projects.active')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {editingId !== project.id && (
          <div className="flex shrink-0 items-center gap-1">
            {project.parent_id && (
              <Button
                size="sm" variant="ghost"
                title={t(project.inherits_content ? 'projects.useOwnContent' : 'projects.useStateContent')}
                onClick={() => void handleToggleInherit(project)}
              >
                <Link2 className={cn('size-4', project.inherits_content && 'text-coral-600 dark:text-coral-300')} />
              </Button>
            )}
            <Button size="sm" variant="ghost" title={t('projects.rename')}
              onClick={() => { setEditingId(project.id); setEditName(project.name); }}>
              <Edit3 className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" title={t('projects.delete')}
              onClick={() => void handleDelete(project)}>
              <Trash2 className="size-4 text-error-600" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('projects.title')}
        description={t('projects.description')}
        actions={
          <>
            <Button variant="outline" iconLeft={<Building2 className="size-4" />}
              onClick={() => openAdd({ level: 'state' })}>
              {t('projects.addState')}
            </Button>
            <Button iconLeft={<Plus className="size-4" />}
              onClick={() => openAdd({ level: 'district', parentId: null })}>
              {t('projects.addDistrict')}
            </Button>
          </>
        }
      />

      {/* State projects, each with its districts */}
      {groups.states.map(({ state, children }) => (
        <div key={state.id} className="flex flex-col gap-2">
          {card(state, false)}
          <div className="ml-4 flex flex-col gap-2 border-l-2 border-border pl-4 sm:ml-6">
            {children.length === 0 ? (
              <p className="py-1 text-[13px] text-ink-faint">{t('projects.noDistrictsYet')}</p>
            ) : (
              children.map(child => card(child, true))
            )}
            <button
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/60 py-2.5 text-[13px] font-semibold text-ink-muted hover:border-coral-500 hover:text-coral-600 cursor-pointer dark:hover:text-coral-300"
              onClick={() => openAdd({ level: 'district', parentId: state.id, parentName: state.name })}
            >
              <Plus className="size-4" /> {t('projects.addDistrictTo', { name: state.name })}
            </button>
          </div>
        </div>
      ))}

      {/* Standalone districts */}
      {groups.standalone.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
            {t('projects.standaloneHeading')}
          </span>
          {groups.standalone.map(project => card(project, false))}
        </div>
      )}

      {groups.flat.length === 0 && (
        <EmptyState icon={<Building2 />} title={t('projects.emptyTitle')} description={t('projects.emptyBody')} />
      )}

      {/* Add project modal */}
      <Modal
        open={addMode !== null}
        onClose={() => setAddMode(null)}
        title={addMode?.level === 'state' ? t('projects.addStateTitle') : t('projects.addDistrictTitle')}
        footer={
          <>
            <Button variant="outline" onClick={() => setAddMode(null)}>{t('projects.cancel')}</Button>
            <Button iconLeft={<Save className="size-4" />} loading={saving} disabled={saving}
              onClick={() => void handleAdd()}>
              {t('projects.create')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <FieldLabel size="sm">{t('projects.fieldName')}</FieldLabel>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder={addMode?.level === 'state' ? t('projects.phState') : t('projects.phDistrict')} />
          </div>

          {addMode?.level === 'district' && (
            <div>
              <FieldLabel size="sm">{t('projects.fieldParent')}</FieldLabel>
              {addMode.parentId ? (
                <Input value={addMode.parentName ?? ''} disabled />
              ) : (
                <Select value={parentId} onChange={e => setParentId(e.target.value)}>
                  <option value="">{t('projects.noParent')}</option>
                  {groups.states.map(({ state }) => (
                    <option key={state.id} value={state.id}>{state.name}</option>
                  ))}
                </Select>
              )}
            </div>
          )}

          {addMode?.level === 'district' && (addMode.parentId || parentId) && (
            <div>
              <Checkbox checked={inherits} onChange={e => setInherits(e.target.checked)}
                label={t('projects.fieldInherits')} />
              <p className="mt-1 pl-6.5 text-[11px] text-ink-faint">{t('projects.hintInherits')}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel size="sm">{t('projects.fieldCode')}</FieldLabel>
              <Input value={code} maxLength={4} placeholder="UJ"
                onChange={e => setCode(e.target.value.toUpperCase())} />
              <p className="mt-1 text-[11px] text-ink-faint">{t('projects.hintCode')}</p>
            </div>
            <div>
              <FieldLabel size="sm">{t('projects.fieldPrefix')}</FieldLabel>
              <Input value={statePrefix} maxLength={2} placeholder="MP"
                onChange={e => setStatePrefix(e.target.value.toUpperCase())} />
              <p className="mt-1 text-[11px] text-ink-faint">{t('projects.hintPrefix')}</p>
            </div>
          </div>

          {formError && <p className="text-[13px] text-error-600">{formError}</p>}
        </div>
      </Modal>
    </div>
  );
};

export default AdminProjectsPage;
