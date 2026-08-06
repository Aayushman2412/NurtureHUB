import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FileArchive, Trash2, Upload } from 'lucide-react';
import type { InputFile, InputKind } from '../../api/pipelines';
import { Badge, Button, Table, THead, TBody, Tr, Th, Td } from '../ui';
import { formatBytes, formatWhen } from './helpers';

interface InputKindCardProps {
  kind: InputKind;
  files: InputFile[];
  uploading: boolean;
  onUpload: (files: File[], kind: string) => void;
  onUploadZip: (file: File, kind: string) => void;
  onDelete: (path: string) => void;
  /** Extra controls for this slot (the crosstabs raw-folder name field). */
  children?: React.ReactNode;
}

/** One upload slot: what it is, what's currently stored, and its own uploader. */
const InputKindCard: React.FC<InputKindCardProps> = ({
  kind, files, uploading, onUpload, onUploadZip, onDelete, children,
}) => {
  const { t } = useTranslation('pipelines');
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = (path: string) => {
    if (!window.confirm(t('inputs.confirmDelete', { path }))) return;
    setDeleting(path);
    Promise.resolve(onDelete(path)).finally(() => setDeleting(null));
  };

  const present = files.length > 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-bold text-ink">{kind.label}</span>
            {kind.required
              ? <Badge variant={present ? 'success' : 'error'} size="sm">
                  {present ? t('inputs.present') : t('inputs.missing')}
                </Badge>
              : <Badge variant={present ? 'success' : 'neutral'} size="sm">
                  {present ? t('inputs.present') : t('inputs.optional')}
                </Badge>}
            {present && files.length > 1 && (
              <span className="text-xs text-ink-muted">{t('inputs.fileCount', { n: files.length })}</span>
            )}
            {present && files[0]?.date && (
              <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-semibold tabular-nums text-ink-muted">
                {files[0].date}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-muted">{kind.description}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-faint">{kind.hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant={present ? 'outline' : 'primary'}
            size="sm"
            iconLeft={<Upload className="size-4" />}
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {present ? t('inputs.replace') : t('inputs.upload')}
          </Button>
          {kind.allows_zip && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<FileArchive className="size-4" />}
              loading={uploading}
              onClick={() => zipRef.current?.click()}
            >
              {t('inputs.zip')}
            </Button>
          )}
        </div>
      </div>

      {children && <div className="mt-3">{children}</div>}

      <input
        ref={fileRef}
        type="file"
        multiple={kind.multiple}
        accept={kind.accept}
        className="hidden"
        onChange={e => {
          const selected = Array.from(e.target.files || []);
          if (selected.length) onUpload(selected, kind.key);
          e.target.value = '';
        }}
      />
      {kind.allows_zip && (
        <input
          ref={zipRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={e => {
            const selected = e.target.files?.[0];
            if (selected) onUploadZip(selected, kind.key);
            e.target.value = '';
          }}
        />
      )}

      {present && (
        <div className="mt-3">
          <Table density="compact">
            <THead>
              <Tr>
                <Th>{t('inputs.colFile')}</Th>
                <Th>{t('inputs.colSize')}</Th>
                <Th>{t('inputs.colModified')}</Th>
                <Th> </Th>
              </Tr>
            </THead>
            <TBody>
              {files.map(file => (
                <Tr key={file.path}>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 shrink-0 text-success-600" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{file.name}</span>
                        {file.path !== file.name && (
                          <span className="block truncate text-[11px] text-ink-faint">{file.path}</span>
                        )}
                      </span>
                    </span>
                  </Td>
                  <Td className="tabular-nums">{formatBytes(file.size)}</Td>
                  <Td className="tabular-nums">{formatWhen(file.modified)}</Td>
                  <Td>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={deleting === file.path}
                      onClick={() => handleDelete(file.path)}
                      title={t('inputs.delete')}
                    >
                      <Trash2 className="size-4 text-error-600" />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default InputKindCard;
