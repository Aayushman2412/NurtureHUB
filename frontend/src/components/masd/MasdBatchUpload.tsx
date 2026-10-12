import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown, FileUp } from 'lucide-react';
import { downloadBatchTemplate, uploadBatchAssignments, type BatchUploadResult } from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { Button, Modal } from '../ui';
import { DataTable, Th } from './MasdCharts';
import { cn } from '../../utils/cn';

const TONE: Record<string, string> = {
  assign: 'text-primary-ink', assigned: 'text-success-600', unchanged: 'text-ink-muted', error: 'text-error-600',
};

/**
 * Put learners in their training batches from an Excel of user ID, name and
 * batch (review of 6 Oct 2026): the file is checked first and reported row by
 * row; nothing changes until "Assign" is pressed.
 */
const MasdBatchUpload: React.FC<{ project: string; onDone: () => void }> = ({ project, onDone }) => {
  const { t } = useTranslation('masd');
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BatchUploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = async (apply: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadBatchAssignments(project, file, apply);
      setResult(r);
      if (apply) {
        showToast(t('batchUpload.applied', { n: r.summary.assigned }), 'success');
        onDone();
      }
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : t('batchUpload.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const close = () => { setOpen(false); setFile(null); setResult(null); };

  return (
    <>
      <Button variant="outline" size="sm" iconLeft={<FileUp className="size-4" />} onClick={() => setOpen(true)}>
        {t('batchUpload.button')}
      </Button>
      <Modal open={open} onClose={close} title={t('batchUpload.title')} size="lg">
        <div className="space-y-4">
          <p className="text-sm text-ink">{t('batchUpload.explain')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" iconLeft={<FileDown className="size-4" />}
              onClick={() => void downloadBatchTemplate(project).catch(() => showToast(t('downloadFailed'), 'error'))}>
              {t('batchUpload.template')}
            </Button>
            <input ref={input} type="file" accept=".xlsx" className="hidden"
              onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>{file ? file.name : t('batchUpload.choose')}</Button>
            <Button size="sm" disabled={!file} loading={busy && !result} onClick={() => void run(false)}>{t('batchUpload.check')}</Button>
          </div>
          {result && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                {(['assign', 'assigned', 'unchanged', 'error'] as const).filter(k => result.summary[k]).map(k => (
                  <span key={k} className={cn('font-semibold', TONE[k])}>{t(`batchUpload.status.${k}`)}: {result.summary[k]}</span>
                ))}
              </div>
              <div className="max-h-80 overflow-y-auto">
                <DataTable>
                  <thead>
                    <tr>
                      <Th>{t('batchUpload.row')}</Th>
                      <Th>{t('batchUpload.userId')}</Th>
                      <Th className="text-left">{t('batchUpload.name')}</Th>
                      <Th>{t('batchUpload.batch')}</Th>
                      <Th className="text-left">{t('batchUpload.result')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map(r => (
                      <tr key={r.row}>
                        <td className="px-3 py-1.5 text-center tabular-nums text-ink-muted">{r.row}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums">{r.user_id ?? '—'}</td>
                        <td className="px-3 py-1.5 text-ink">{r.learner || r.name}{r.learner && r.name && r.learner !== r.name && <span className="text-xs text-ink-faint"> ({r.name})</span>}</td>
                        <td className="px-3 py-1.5 text-center">{r.from ? `${r.from} → ` : ''}{r.batch}</td>
                        <td className={cn('px-3 py-1.5 text-sm', TONE[r.status])}>
                          {t(`batchUpload.status.${r.status}`)}{r.message ? ` — ${r.message}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
              {!result.applied && result.summary.assign > 0 && (
                <div className="flex justify-end">
                  <Button loading={busy} onClick={() => void run(true)}>{t('batchUpload.apply', { n: result.summary.assign })}</Button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
};

export default MasdBatchUpload;
