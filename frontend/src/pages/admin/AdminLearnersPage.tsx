import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, Users, Pencil, Trash2, Save, ShieldCheck, ShieldAlert, MoveRight, X,
} from 'lucide-react';
import {
  Alert, Badge, Button, Card, Checkbox, EmptyState, FieldLabel, Input, Modal, PageHeader,
  PageLoader, Select, Table, TBody, Td, Th, THead, Tr,
} from '../../components/ui';
import {
  bulkAssignLearners, deleteLearner, listLearners, updateLearner,
  type AdminLearner,
} from '../../api/adminLearners';
import { listProjects } from '../../api/projects';
import type { AdminProject } from '../../lib/adminProject';
import { cn } from '../../utils/cn';

const PAGE_SIZE = 100;

/**
 * The learner directory: every registered account, searchable, with the four
 * things an admin actually needs — see who signed up, fix their details, move
 * them to the right project, and remove test/trial accounts.
 *
 * Deliberately NOT scoped to the sidebar project: finding a stray account
 * ("I registered on an old trial project") means looking across all of them.
 */
const AdminLearnersPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const [learners, setLearners] = useState<AdminLearner[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<AdminProject[]>([]);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('');

  const [selected, setSelected] = useState<number[]>([]);
  const [bulkTarget, setBulkTarget] = useState<string>('');
  const [banner, setBanner] = useState('');

  const [editing, setEditing] = useState<AdminLearner | null>(null);
  const [draft, setDraft] = useState<Partial<AdminLearner>>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<AdminLearner | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listLearners({
      q: appliedSearch,
      projectId: projectFilter === '' ? null : Number(projectFilter),
      limit: PAGE_SIZE,
      offset,
    })
      .then(page => {
        setLearners(page.users);
        setTotal(page.total);
      })
      .catch(() => setLearners([]))
      .finally(() => setLoading(false));
  }, [appliedSearch, projectFilter, offset]);

  useEffect(load, [load]);
  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const projectName = (id: number | null) =>
    projects.find(p => p.id === id)?.name ?? t('learners.unassigned');

  const runSearch = () => {
    setOffset(0);
    setAppliedSearch(search.trim());
  };

  const openEdit = (learner: AdminLearner) => {
    setEditError('');
    setDraft({ ...learner });
    setEditing(learner);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setEditError('');
    try {
      await updateLearner(editing.id, {
        full_name: draft.full_name ?? null,
        email: draft.email,
        phone: draft.phone ?? null,
        learner_category: draft.learner_category ?? null,
        work_center_name: draft.work_center_name ?? null,
        is_verified: draft.is_verified,
        program_district_id: draft.program_district_id ?? null,
      });
      setEditing(null);
      setBanner(t('learners.savedBanner', { name: draft.full_name || draft.email }));
      load();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setEditError(detail || t('learners.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteLearner(confirmDelete.id);
      setBanner(t('learners.deletedBanner', { email: confirmDelete.email }));
      setConfirmDelete(null);
      setSelected(prev => prev.filter(id => id !== confirmDelete.id));
      load();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || t('learners.deleteFailed'));
    }
  };

  const runBulkAssign = async () => {
    if (selected.length === 0 || bulkTarget === '') return;
    const target = bulkTarget === 'none' ? null : Number(bulkTarget);
    const res = await bulkAssignLearners(selected, target);
    setBanner(t('learners.movedBanner', {
      n: res.moved,
      project: target === null ? t('learners.unassigned') : projectName(target),
    }));
    setSelected([]);
    setBulkTarget('');
    load();
  };

  const allOnPageSelected = learners.length > 0 && learners.every(l => selected.includes(l.id));

  return (
    <div>
      <PageHeader title={t('learners.title')} description={t('learners.description')} />

      {banner && (
        <Alert variant="success" className="mb-4">
          <span className="flex items-center justify-between gap-3">
            {banner}
            <button className="cursor-pointer" onClick={() => setBanner('')} aria-label={t('learners.dismiss')}>
              <X className="size-3.5" />
            </button>
          </span>
        </Alert>
      )}

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FieldLabel size="sm">{t('learners.searchLabel')}</FieldLabel>
            <Input
              value={search}
              placeholder={t('learners.searchPlaceholder')}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
            />
          </div>
          <div className="sm:w-64">
            <FieldLabel size="sm">{t('learners.projectFilter')}</FieldLabel>
            <Select
              value={projectFilter}
              onChange={e => { setOffset(0); setProjectFilter(e.target.value); }}
            >
              <option value="">{t('learners.allProjects')}</option>
              <option value="-1">{t('learners.unassignedOnly')}</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <Button iconLeft={<Search className="size-4" />} onClick={runSearch}>
            {t('learners.search')}
          </Button>
        </div>
      </Card>

      {/* Bulk actions */}
      {selected.length > 0 && (
        <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <span className="text-sm font-semibold text-ink">
            {t('learners.selectedCount', { n: selected.length })}
          </span>
          <Select
            className="sm:w-64"
            value={bulkTarget}
            onChange={e => setBulkTarget(e.target.value)}
          >
            <option value="">{t('learners.chooseProject')}</option>
            <option value="none">{t('learners.unassigned')}</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Button
            iconLeft={<MoveRight className="size-4" />}
            disabled={bulkTarget === ''}
            onClick={() => void runBulkAssign()}
          >
            {t('learners.moveSelected')}
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>{t('learners.clearSelection')}</Button>
        </Card>
      )}

      {loading ? (
        <PageLoader label={t('learners.loading')} />
      ) : learners.length === 0 ? (
        <EmptyState icon={<Users />} title={t('learners.emptyTitle')} description={t('learners.emptyBody')} />
      ) : (
        <Card className="overflow-hidden">
          <Table density="compact">
            <THead>
              <Tr>
                <Th className="w-10">
                  <Checkbox
                    checked={allOnPageSelected}
                    onChange={e =>
                      setSelected(e.target.checked
                        ? Array.from(new Set([...selected, ...learners.map(l => l.id)]))
                        : selected.filter(id => !learners.some(l => l.id === id)))
                    }
                  />
                </Th>
                <Th>{t('learners.colName')}</Th>
                <Th>{t('learners.colEmail')}</Th>
                <Th>{t('learners.colProject')}</Th>
                <Th className="text-center">{t('learners.colVerified')}</Th>
                <Th className="text-center">{t('learners.colAttempts')}</Th>
                <Th className="w-20" />
              </Tr>
            </THead>
            <TBody>
              {learners.map(learner => (
                <Tr key={learner.id}>
                  <Td>
                    <Checkbox
                      checked={selected.includes(learner.id)}
                      onChange={e =>
                        setSelected(prev =>
                          e.target.checked ? [...prev, learner.id] : prev.filter(id => id !== learner.id))
                      }
                    />
                  </Td>
                  <Td className="font-semibold text-ink">
                    {learner.full_name || <span className="text-ink-faint">{t('learners.noName')}</span>}
                    {learner.is_admin && <Badge variant="coral" className="ml-2">{t('learners.adminBadge')}</Badge>}
                    {learner.role && <span className="block text-[11px] text-ink-faint">{learner.role}</span>}
                  </Td>
                  <Td className="text-ink-muted">{learner.email}</Td>
                  <Td>
                    <span className={cn(!learner.program_district_id && 'text-ink-faint')}>
                      {learner.program_district_name || t('learners.unassigned')}
                    </span>
                  </Td>
                  <Td className="text-center">
                    {learner.is_verified
                      ? <ShieldCheck className="mx-auto size-4 text-success-600 dark:text-success-400" />
                      : <ShieldAlert className="mx-auto size-4 text-ink-faint" />}
                  </Td>
                  <Td className="text-center text-ink-muted">{learner.attempts}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <button
                        title={t('learners.edit')}
                        onClick={() => openEdit(learner)}
                        className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        title={t('learners.delete')}
                        onClick={() => setConfirmDelete(learner)}
                        className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-ink-muted">
            <span>
              {t('learners.showing', {
                from: total === 0 ? 0 : offset + 1,
                to: offset + learners.length,
                total,
              })}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                {t('learners.prev')}
              </Button>
              <Button size="sm" variant="outline" disabled={offset + learners.length >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}>
                {t('learners.next')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Edit learner */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('learners.editTitle', { name: editing?.full_name || editing?.email || '' })}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>{t('learners.cancel')}</Button>
            <Button iconLeft={<Save className="size-4" />} loading={saving} disabled={saving}
              onClick={() => void saveEdit()}>
              {t('learners.save')}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel size="sm">{t('learners.fieldName')}</FieldLabel>
            <Input value={draft.full_name ?? ''} onChange={e => setDraft({ ...draft, full_name: e.target.value })} />
          </div>
          <div>
            <FieldLabel size="sm">{t('learners.fieldEmail')}</FieldLabel>
            <Input value={draft.email ?? ''} onChange={e => setDraft({ ...draft, email: e.target.value })} />
          </div>
          <div>
            <FieldLabel size="sm">{t('learners.fieldPhone')}</FieldLabel>
            <Input value={draft.phone ?? ''} onChange={e => setDraft({ ...draft, phone: e.target.value })} />
          </div>
          <div>
            <FieldLabel size="sm">{t('learners.fieldCategory')}</FieldLabel>
            <Input value={draft.learner_category ?? ''}
              onChange={e => setDraft({ ...draft, learner_category: e.target.value })} />
          </div>
          <div>
            <FieldLabel size="sm">{t('learners.fieldWorkCenter')}</FieldLabel>
            <Input value={draft.work_center_name ?? ''}
              onChange={e => setDraft({ ...draft, work_center_name: e.target.value })} />
          </div>
          <div>
            <FieldLabel size="sm">{t('learners.fieldProject')}</FieldLabel>
            <Select
              value={draft.program_district_id ?? ''}
              onChange={e => setDraft({
                ...draft,
                program_district_id: e.target.value === '' ? null : Number(e.target.value),
              })}
            >
              <option value="">{t('learners.unassigned')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="mt-3">
          <Checkbox
            checked={!!draft.is_verified}
            onChange={e => setDraft({ ...draft, is_verified: e.target.checked })}
            label={t('learners.fieldVerified')}
          />
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">{t('learners.reassignNote')}</p>
        {editError && <p className="mt-3 text-[13px] text-error-600">{editError}</p>}
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('learners.deleteTitle')}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>{t('learners.cancel')}</Button>
            <Button variant="danger" iconLeft={<Trash2 className="size-4" />} onClick={() => void runDelete()}>
              {t('learners.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p className="mt-0 text-sm text-ink">
          {t('learners.deleteBody', { email: confirmDelete?.email ?? '' })}
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-ink-muted">
          <li>{t('learners.deleteLosesAttempts', { n: confirmDelete?.attempts ?? 0 })}</li>
          <li>{t('learners.deleteKeepsMothers', { n: confirmDelete?.mothers ?? 0 })}</li>
          <li>{t('learners.deleteIrreversible')}</li>
        </ul>
      </Modal>
    </div>
  );
};

export default AdminLearnersPage;
