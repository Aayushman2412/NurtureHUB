import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Edit3,
  GitBranch,
  GitCommitHorizontal,
  MapPin,
  Plus,
  Star,
} from 'lucide-react';
import client from '../../../api/client';
import {
  adminListFormVersions,
  adminMakeVersionDefault,
  adminSetVersionDistricts,
  type FormVersionSummary,
  type FormVersionsList,
} from '../../../api/forms';
import { FORM_KEYS, type FormKey } from '../../../lib/flowTypes';
import { Alert, Badge, Button, Card, Modal, PageHeader, Skeleton, Spinner } from '../../../components/ui';
import { useToast } from '../../../context/ToastContext';
import { cn } from '../../../utils/cn';

interface ProgramDistrict {
  id: number;
  name: string;
  slug: string;
}

/**
 * Git-style history of one form: every save is an immutable version with an
 * admin-entered date + change description. Districts are pinned to a specific
 * version; unpinned districts follow the form's default version.
 */
const FormVersionsPage: React.FC = () => {
  const { formKey } = useParams<{ formKey: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('adminFormBuilder');
  const { showToast } = useToast();

  const [data, setData] = useState<FormVersionsList | null>(null);
  const [districts, setDistricts] = useState<ProgramDistrict[]>([]);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // districts-assignment modal
  const [assignFor, setAssignFor] = useState<FormVersionSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [savingAssign, setSavingAssign] = useState(false);
  const [makingDefault, setMakingDefault] = useState<number | null>(null);

  const validKey = !!formKey && (FORM_KEYS as readonly string[]).includes(formKey);

  useEffect(() => {
    if (!validKey) return;
    let cancelled = false;
    setError(false);
    setData(null);
    Promise.all([
      adminListFormVersions(formKey as FormKey),
      client.get<ProgramDistrict[]>('/api/admin/districts').then(r => r.data),
    ])
      .then(([versions, districtList]) => {
        if (cancelled) return;
        setData(versions);
        setDistricts(districtList);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [formKey, validKey, reloadTick]);

  /** district id → the version number it is currently pinned to (any version). */
  const pinnedTo = useMemo(() => {
    const map = new Map<number, number>();
    for (const v of data?.versions ?? []) {
      for (const d of v.districts) map.set(d.id, v.version_number);
    }
    return map;
  }, [data]);

  if (!validKey) {
    return (
      <Alert variant="error" title={t('versions.unknownForm')}>
        <Button variant="outline" size="sm" onClick={() => navigate('/admin/form-builder')}>
          {t('versions.backToHub')}
        </Button>
      </Alert>
    );
  }

  const editorPath = (versionNumber?: number) => {
    const base = `/admin/form-builder/${data?.builder_type === 'flow' ? 'flow' : 'flat'}/${formKey}`;
    return versionNumber ? `${base}?v=${versionNumber}` : base;
  };

  const openAssign = (version: FormVersionSummary) => {
    setAssignFor(version);
    setSelectedIds(new Set(version.districts.map(d => d.id)));
  };

  const saveAssign = async () => {
    if (!assignFor) return;
    setSavingAssign(true);
    try {
      await adminSetVersionDistricts(formKey as FormKey, assignFor.version_number, [...selectedIds]);
      showToast(t('versions.districtsSaved', { n: assignFor.version_number }), 'success');
      setAssignFor(null);
      setReloadTick(x => x + 1);
    } catch {
      showToast(t('versions.districtsSaveFailed'), 'error');
    } finally {
      setSavingAssign(false);
    }
  };

  const makeDefault = async (version: FormVersionSummary) => {
    setMakingDefault(version.version_number);
    try {
      await adminMakeVersionDefault(formKey as FormKey, version.version_number);
      showToast(t('versions.defaultSaved', { n: version.version_number }), 'success');
      setReloadTick(x => x + 1);
    } catch {
      showToast(t('versions.defaultSaveFailed'), 'error');
    } finally {
      setMakingDefault(null);
    }
  };

  const latest = data?.versions?.[0]?.version_number;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <GitBranch className="size-5 text-primary-ink" />
            {data?.title ?? formKey}
            <Badge variant="neutral">{t('versions.count', { count: data?.versions.length ?? 0 })}</Badge>
          </span>
        }
        description={t('versions.pageBlurb')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" iconLeft={<ArrowLeft className="size-4" />} onClick={() => navigate('/admin/form-builder')}>
              {t('versions.backToHub')}
            </Button>
            <Button
              variant="primary"
              iconLeft={<Plus className="size-4" />}
              onClick={() => navigate(editorPath(latest))}
              disabled={!data}
            >
              {t('versions.newVersion')}
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="space-y-4">
          <Alert variant="error" title={t('versions.loadError')} />
          <Button variant="outline" onClick={() => setReloadTick(x => x + 1)}>
            {t('versions.retry')}
          </Button>
        </div>
      ) : data === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="block" className="h-24" />
          ))}
        </div>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-border pl-6">
          {data.versions.map(version => (
            <li key={version.id} className="relative">
              {/* timeline dot */}
              <span
                className={cn(
                  'absolute -left-[31px] top-5 flex size-4 items-center justify-center rounded-full border-2',
                  version.is_default
                    ? 'border-coral-500 bg-coral-500 text-white'
                    : 'border-border bg-surface',
                )}
              >
                {version.is_default && <Star className="size-2.5 fill-current" />}
              </span>

              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
                        <GitCommitHorizontal className="size-4 text-ink-muted" />
                        {t('versions.versionN', { n: version.version_number })}
                      </span>
                      {version.is_default && <Badge variant="coral">{t('versions.defaultBadge')}</Badge>}
                      <span className="flex items-center gap-1 text-xs text-ink-muted">
                        <CalendarDays className="size-3.5" />
                        {version.created_on ?? '—'}
                      </span>
                      {version.created_by && (
                        <span className="text-xs text-ink-faint">· {version.created_by}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink">{version.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <MapPin className="size-3.5 text-ink-faint" />
                      {version.districts.length === 0 ? (
                        <span className="text-xs text-ink-faint">{t('versions.noDistricts')}</span>
                      ) : (
                        version.districts.map(d => (
                          <Badge key={d.id} variant="neutral">
                            {d.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      iconLeft={<Edit3 className="size-3.5" />}
                      onClick={() => navigate(editorPath(version.version_number))}
                    >
                      {t('versions.open')}
                    </Button>
                    <Button size="sm" variant="outline" iconLeft={<MapPin className="size-3.5" />} onClick={() => openAssign(version)}>
                      {t('versions.assignDistricts')}
                    </Button>
                    {!version.is_default && (
                      <Button
                        size="sm"
                        variant="outline"
                        iconLeft={
                          makingDefault === version.version_number ? <Spinner className="size-3.5" /> : <Star className="size-3.5" />
                        }
                        disabled={makingDefault !== null}
                        onClick={() => void makeDefault(version)}
                      >
                        {t('versions.makeDefault')}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {/* ── assign-districts modal ─────────────────────────────────────────── */}
      {assignFor && (
        <Modal
          open
          onClose={() => setAssignFor(null)}
          size="md"
          title={t('versions.assignTitle', { n: assignFor.version_number })}
          footer={
            <>
              <Button variant="outline" onClick={() => setAssignFor(null)}>
                {t('versions.cancel')}
              </Button>
              <Button variant="primary" onClick={() => void saveAssign()} disabled={savingAssign}>
                {savingAssign ? t('versions.saving') : t('versions.saveDistricts')}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-ink-muted">{t('versions.assignBlurb')}</p>
          {districts.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('versions.noDistrictsExist')}</p>
          ) : (
            <ul className="space-y-1.5">
              {districts.map(district => {
                const checked = selectedIds.has(district.id);
                const pinnedVersion = pinnedTo.get(district.id);
                const pinnedElsewhere =
                  pinnedVersion !== undefined && pinnedVersion !== assignFor.version_number;
                return (
                  <li key={district.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors',
                        checked ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-surface-sunken',
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(district.id) : next.delete(district.id);
                              return next;
                            });
                          }}
                          className="accent-primary"
                        />
                        <span className="text-sm font-medium text-ink">{district.name}</span>
                      </span>
                      {pinnedElsewhere ? (
                        <span className="text-[11px] text-amber-600">
                          {t('versions.pinnedTo', { n: pinnedVersion })}
                        </span>
                      ) : pinnedVersion === assignFor.version_number ? (
                        <span className="flex items-center gap-1 text-[11px] text-success-600">
                          <Check className="size-3" />
                          {t('versions.pinnedHere')}
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-faint">{t('versions.followsDefault')}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
};

export default FormVersionsPage;
