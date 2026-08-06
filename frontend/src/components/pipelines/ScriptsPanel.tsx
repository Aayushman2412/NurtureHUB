import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileCode2, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { PipelineKey, ScriptSlot } from '../../api/pipelines';
import {
  activatePipelineScript, deactivatePipelineScript, deletePipelineScript,
  downloadPipelineScript, uploadPipelineScript,
} from '../../api/pipelines';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, CardBody, Table, THead, TBody, Tr, Th, Td } from '../ui';
import { formatWhen } from './helpers';

interface ScriptsPanelProps {
  pipeline: PipelineKey;
  slots: ScriptSlot[];
  onChanged: () => void;
}

/** Script slots: vendored default + uploaded versions, activate/revert/download. */
const ScriptsPanel: React.FC<ScriptsPanelProps> = ({ pipeline, slots, onChanged }) => {
  const { t } = useTranslation('pipelines');
  const { showToast } = useToast();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadSlot, setUploadSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const wrap = async (key: string, action: () => Promise<unknown>, successMsg?: string) => {
    setBusy(key);
    try {
      await action();
      if (successMsg) showToast(successMsg, 'success');
      onChanged();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast(detail || t('errors.actionFailed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleUploadPick = (slot: string) => {
    setUploadSlot(slot);
    uploadRef.current?.click();
  };

  const handleDownload = (slot: string, version?: number, name?: string) => {
    downloadPipelineScript(pipeline, slot, version, name)
      .catch(() => showToast(t('errors.downloadFailed'), 'error'));
  };

  const handleUpload = (file: File) => {
    if (!uploadSlot) return;
    const slot = uploadSlot;
    void wrap(`upload:${slot}`, () => uploadPipelineScript(pipeline, slot, file), t('scripts.uploaded'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{t('scripts.intro')}</p>
      <input
        ref={uploadRef}
        type="file"
        accept=".py,.ipynb"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = '';
        }}
      />
      {slots.map(slot => {
        const activeLabel = slot.multi
          ? t('scripts.activeCount', { n: slot.versions.filter(v => v.is_active).length })
          : slot.active_version != null
            ? t('scripts.activeVersion', { n: slot.active_version })
            : t('scripts.default');
        return (
          <Card key={slot.slot}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-surface-sunken">
                  <FileCode2 className="size-4.5 text-primary-ink" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold text-ink">{slot.label}</div>
                  <div className="truncate text-xs text-ink-muted">
                    {slot.canonical
                      ? t('scripts.replaces', { file: slot.canonical })
                      : t('scripts.extraHint')}
                  </div>
                </div>
                <Badge variant={slot.active_version != null || (slot.multi && slot.versions.some(v => v.is_active)) ? 'coral' : 'neutral'} size="sm">
                  {activeLabel}
                </Badge>
                {slot.canonical && (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<Download className="size-4" />}
                    onClick={() => handleDownload(slot.slot, undefined, slot.canonical || undefined)}
                  >
                    {t('scripts.downloadActive')}
                  </Button>
                )}
                {!slot.multi && slot.active_version != null && (
                  <Button
                    variant="outline"
                    size="sm"
                    iconLeft={<RotateCcw className="size-4" />}
                    loading={busy === `revert:${slot.slot}`}
                    onClick={() => void wrap(`revert:${slot.slot}`,
                      () => activatePipelineScript(pipeline, slot.slot, null), t('scripts.reverted'))}
                  >
                    {t('scripts.revert')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Upload className="size-4" />}
                  loading={busy === `upload:${slot.slot}`}
                  onClick={() => handleUploadPick(slot.slot)}
                >
                  {t('scripts.uploadNew')}
                </Button>
              </div>

              {slot.versions.length > 0 && (
                <Table density="compact">
                  <THead>
                    <Tr>
                      <Th>{t('scripts.colVersion')}</Th>
                      <Th>{t('scripts.colFile')}</Th>
                      <Th>{t('scripts.colUploaded')}</Th>
                      <Th>{t('scripts.colStatus')}</Th>
                      <Th> </Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {slot.versions.map(v => (
                      <Tr key={v.version}>
                        <Td className="tabular-nums">v{v.version}</Td>
                        <Td>{v.original_name}</Td>
                        <Td className="tabular-nums">
                          {formatWhen(v.created_at)}
                          {v.created_by ? <span className="ml-1 text-xs text-ink-faint">({v.created_by})</span> : null}
                        </Td>
                        <Td>
                          {v.is_active
                            ? <Badge variant="success" size="sm">{t('scripts.active')}</Badge>
                            : <Badge variant="neutral" size="sm">{t('scripts.inactive')}</Badge>}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            {!v.is_active && (
                              <Button
                                variant="ghost" size="sm"
                                loading={busy === `act:${slot.slot}:${v.version}`}
                                onClick={() => void wrap(`act:${slot.slot}:${v.version}`,
                                  () => activatePipelineScript(pipeline, slot.slot, v.version), t('scripts.activated'))}
                              >
                                {t('scripts.activate')}
                              </Button>
                            )}
                            {v.is_active && slot.multi && (
                              <Button
                                variant="ghost" size="sm"
                                loading={busy === `deact:${slot.slot}:${v.version}`}
                                onClick={() => void wrap(`deact:${slot.slot}:${v.version}`,
                                  () => deactivatePipelineScript(pipeline, slot.slot, v.version))}
                              >
                                {t('scripts.deactivate')}
                              </Button>
                            )}
                            <Button
                              variant="ghost" size="sm"
                              title={t('scripts.download')}
                              onClick={() => handleDownload(slot.slot, v.version, v.original_name)}
                            >
                              <Download className="size-4" />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              title={t('scripts.deleteVersion')}
                              loading={busy === `del:${slot.slot}:${v.version}`}
                              onClick={() => {
                                if (!window.confirm(t('scripts.confirmDelete', { n: v.version }))) return;
                                void wrap(`del:${slot.slot}:${v.version}`,
                                  () => deletePipelineScript(pipeline, slot.slot, v.version));
                              }}
                            >
                              <Trash2 className="size-4 text-error-600" />
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
};

export default ScriptsPanel;
