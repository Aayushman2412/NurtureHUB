import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, FileArchive, Lock, Trash2 } from 'lucide-react';
import type { InputFile, InputGroup, InputKind } from '../../api/pipelines';
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
  /** Extra controls rendered inside a specific slot, keyed by kind. */
  slotExtras?: Record<string, React.ReactNode>;
  /** Rendered above the sections (status banners etc.). */
  extra?: React.ReactNode;
}

/** Inputs tab: one upload section per input type, grouped by how they behave —
 *  run data replaced every run vs fixed reference sheets. */
const InputsPanel: React.FC<InputsPanelProps> = ({
  files, kinds, uploading, onUploadFiles, onUploadZip, onDelete, onDeleteGroup,
  slotExtras, extra,
}) => {
  const { t } = useTranslation('pipelines');
  const bulkZipRef = useRef<HTMLInputElement>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);

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
                <span className="min-w-0 flex-1 truncate text-ink">{file.path}</span>
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
