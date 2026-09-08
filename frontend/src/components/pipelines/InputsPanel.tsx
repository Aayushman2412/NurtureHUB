import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarClock, Download, FileArchive, FileSpreadsheet, Lock, Trash2, X,
} from 'lucide-react';
import type {
  InputBundleFormat, InputFile, InputGroup, InputKind,
} from '../../api/pipelines';
import { Button } from '../ui';
import InputKindCard from './InputKindCard';

interface InputsPanelProps {
  files: InputFile[];
  kinds: InputKind[];
  uploading: boolean;
  onUploadFiles: (files: File[], kind?: string) => void;
  onUploadZip: (file: File, kind?: string) => void;
  onDelete: (path: string) => void;
  onDeleteGroup: (group: InputGroup | 'all') => void;
  /** Download a single stored file. */
  onDownload: (path: string) => void | Promise<void>;
  /** Bundle everything, or just `paths`, as a zip or a combined workbook. */
  onDownloadBundle: (
    format: InputBundleFormat, paths?: string[],
  ) => void | Promise<void>;
  /** Extra controls rendered inside a specific slot, keyed by kind. */
  slotExtras?: Record<string, React.ReactNode>;
  /** Rendered above the sections (status banners etc.). */
  extra?: React.ReactNode;
}

/** Inputs tab: one upload section per input type, grouped by how they behave —
 *  run data replaced every run vs fixed reference sheets. */
const InputsPanel: React.FC<InputsPanelProps> = ({
  files, kinds, uploading, onUploadFiles, onUploadZip, onDelete, onDeleteGroup,
  onDownload, onDownloadBundle, slotExtras, extra,
}) => {
  const { t } = useTranslation('pipelines');
  const bulkZipRef = useRef<HTMLInputElement>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const byKind = useMemo(() => {
    const map = new Map<string, InputFile[]>();
    for (const file of files) {
      const list = map.get(file.kind) || [];
      list.push(file);
      map.set(file.kind, list);
    }
    return map;
  }, [files]);

  const other = byKind.get('other') || [];

  // A deleted or replaced file must not stay silently ticked, or the next
  // "download selected" asks the server for something that no longer exists.
  const known = useMemo(() => new Set(files.map(f => f.path)), [files]);
  const selectedPaths = useMemo(
    () => files.filter(f => selected.has(f.path)).map(f => f.path),
    [files, selected],
  );
  React.useEffect(() => {
    setSelected(prev => {
      const next = new Set([...prev].filter(p => known.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [known]);

  const toggle = (path: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const toggleMany = (paths: string[], select: boolean) => setSelected(prev => {
    const next = new Set(prev);
    for (const p of paths) {
      if (select) next.add(p);
      else next.delete(p);
    }
    return next;
  });

  const runDownload = (key: string, fn: () => void | Promise<void>) => {
    setBusy(key);
    Promise.resolve(fn()).finally(() => setBusy(null));
  };

  const downloadButtons = (
    keyPrefix: string,
    paths: string[] | undefined,
    size: 'sm' = 'sm',
  ) => (
    <>
      <Button
        variant="secondary"
        size={size}
        iconLeft={<FileArchive className="size-4" />}
        loading={busy === `${keyPrefix}:zip`}
        onClick={() => runDownload(`${keyPrefix}:zip`, () => onDownloadBundle('zip', paths))}
      >
        {t('inputs.downloadZip')}
      </Button>
      <Button
        variant="outline"
        size={size}
        iconLeft={<FileSpreadsheet className="size-4" />}
        loading={busy === `${keyPrefix}:xlsx`}
        onClick={() => runDownload(`${keyPrefix}:xlsx`, () => onDownloadBundle('xlsx', paths))}
      >
        {t('inputs.downloadExcel')}
      </Button>
    </>
  );

  const handleDeleteGroup = (group: InputGroup | 'all', count: number) => {
    const key = group === 'reference'
      ? 'inputs.confirmDeleteReference'
      : group === 'all' ? 'inputs.confirmDeleteAll' : 'inputs.confirmDeleteDated';
    if (!window.confirm(t(key, { n: count }))) return;
    setDeletingGroup(group);
    Promise.resolve(onDeleteGroup(group)).finally(() => setDeletingGroup(null));
  };

  const groupSection = (
    group: InputGroup,
    icon: React.ReactNode,
    title: string,
    description: string,
  ) => {
    const groupKinds = kinds.filter(k => k.group === group);
    if (groupKinds.length === 0) return null;
    const count = files.filter(f => f.group === group).length;
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-sm font-bold text-ink">
              {title} <span className="font-normal text-ink-muted">({count})</span>
            </h3>
            <p className="text-xs text-ink-muted">{description}</p>
          </div>
          {count > 0 && (
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Trash2 className="size-4" />}
              loading={deletingGroup === group}
              onClick={() => handleDeleteGroup(group, count)}
            >
              {t('inputs.deleteAllInSection')}
            </Button>
          )}
        </div>
        {count === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-ink-muted">
            {t(group === 'dated' ? 'inputs.noDated' : 'inputs.noReference')}
          </p>
        )}
        <div className="space-y-3">
          {groupKinds.map(kind => (
            <InputKindCard
              key={kind.key}
              kind={kind}
              files={byKind.get(kind.key) || []}
              uploading={uploading}
              onUpload={onUploadFiles}
              onUploadZip={onUploadZip}
              onDelete={onDelete}
              onDownload={onDownload}
              selected={selected}
              onToggle={toggle}
              onToggleMany={toggleMany}
            >
              {slotExtras?.[kind.key]}
            </InputKindCard>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-6">
      {/* Whole-workspace shortcut: one zip, auto-sorted into the slots below. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-sunken p-4">
        <FileArchive className="size-5 shrink-0 text-primary-ink" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold text-ink">{t('inputs.bulkZipTitle')}</div>
          <p className="text-xs text-ink-muted">{t('inputs.bulkZipDescription')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<FileArchive className="size-4" />}
          loading={uploading}
          onClick={() => bulkZipRef.current?.click()}
        >
          {t('inputs.uploadZip')}
        </Button>
        {files.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Trash2 className="size-4 text-error-600" />}
            loading={deletingGroup === 'all'}
            onClick={() => handleDeleteGroup('all', files.length)}
          >
            {t('inputs.deleteAll')}
          </Button>
        )}
        <input
          ref={bulkZipRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={e => {
            const selected = e.target.files?.[0];
            if (selected) onUploadZip(selected);
            e.target.value = '';
          }}
        />
      </div>

      {/* Getting the inputs back out. The two formats answer different
          questions: the zip is the archive (re-uploadable, byte-identical),
          the workbook is for reading and cross-checking in one place. */}
      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Download className="size-5 shrink-0 text-primary-ink" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm font-bold text-ink">
              {t('inputs.downloadTitle')}{' '}
              <span className="font-normal text-ink-muted">({files.length})</span>
            </div>
            <p className="text-xs text-ink-muted">{t('inputs.downloadDescription')}</p>
          </div>
          <span className="text-xs font-semibold text-ink-muted">{t('inputs.downloadAll')}</span>
          {downloadButtons('all', undefined)}
        </div>
      )}

      {/* Only appears once something is ticked, so the default view stays calm. */}
      {selectedPaths.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary-soft p-3 shadow-sm">
          <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
            {t('inputs.selectedCount', { count: selectedPaths.length })}
          </span>
          <span className="text-xs font-semibold text-ink-muted">
            {t('inputs.downloadSelected')}
          </span>
          {downloadButtons('sel', selectedPaths)}
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<X className="size-4" />}
            onClick={() => setSelected(new Set())}
          >
            {t('inputs.clearSelection')}
          </Button>
        </div>
      )}

      {extra}

      {groupSection(
        'dated',
        <CalendarClock className="size-4.5 text-primary-ink" />,
        t('inputs.datedTitle'),
        t('inputs.datedDescription'),
      )}

      {groupSection(
        'reference',
        <Lock className="size-4.5 text-ink-muted" />,
        t('inputs.referenceTitle'),
        t('inputs.referenceDescription'),
      )}

      {other.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-bold text-ink">
            {t('inputs.otherTitle')} <span className="font-normal text-ink-muted">({other.length})</span>
          </h3>
          <p className="text-xs text-ink-muted">{t('inputs.otherDescription')}</p>
          <div className="rounded-xl border border-border bg-surface p-3">
            {other.map(file => (
              <div key={file.path} className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 cursor-pointer accent-primary"
                  checked={selected.has(file.path)}
                  onChange={() => toggle(file.path)}
                  aria-label={t('inputs.selectFile')}
                />
                <span className="min-w-0 flex-1 truncate text-ink">{file.path}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy === `one:${file.path}`}
                  onClick={() => runDownload(`one:${file.path}`, () => onDownload(file.path))}
                  title={t('inputs.download')}
                >
                  <Download className="size-4 text-ink-muted" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(t('inputs.confirmDelete', { path: file.path }))) onDelete(file.path);
                  }}
                  title={t('inputs.delete')}
                >
                  <Trash2 className="size-4 text-error-600" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default InputsPanel;
