import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive, Download, Eye, EyeOff, FileText, PlayCircle, ScrollText, Trash2,
} from 'lucide-react';
import type { ManifestEntry, PipelineRun } from '../../api/pipelines';
import {
  deletePipelineRun, downloadRunFile, downloadRunZip, getPipelineRunLog,
} from '../../api/pipelines';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Card, CardBody, Checkbox, EmptyState, Modal, Spinner,
  Table, THead, TBody, Tr, Th, Td,
} from '../ui';
import { formatBytes, formatWhen, isRunActive, runDuration, statusBadgeVariant } from './helpers';

interface RunsPanelProps {
  runs: PipelineRun[];
  selectedRun: PipelineRun | null;
  selectedLoading: boolean;
  onSelect: (runId: number) => void;
  onChanged: () => void;
  /** Run trigger controls rendered in the panel header (page-specific). */
  triggerControls: React.ReactNode;
  /** Optional variant -> label map; when given, each run row shows its variant. */
  variantLabels?: Record<string, string>;
}

/** Run history + outputs browser (sections, multi-select, zip downloads, logs). */
const RunsPanel: React.FC<RunsPanelProps> = ({
  runs, selectedRun, selectedLoading, onSelect, onChanged, triggerControls, variantLabels,
}) => {
  const { t } = useTranslation('pipelines');
  const { showToast } = useToast();
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [logOpen, setLogOpen] = useState(false);
  const [logFile, setLogFile] = useState<'console' | 'pipeline' | 'report'>('console');
  const [logText, setLogText] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  // A running pipeline re-fetches its log every 5s. Follow the tail only while
  // the reader is already at the bottom, so scrolling up to read something
  // isn't yanked away by the next poll.
  const followTail = useRef(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  // The "Requested CTs" sections hold ~100 individual table workbooks; by
  // default only the custom_report_tables summary shows, the rest sit behind
  // an explicit unhide. Always collapsed again on run switch.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Reset file selection when switching runs.
  useEffect(() => {
    setSelectedPaths(new Set());
    setExpandedSections(new Set());
  }, [selectedRun?.id]);

  // Load (and refresh while running) the log when the modal is open.
  useEffect(() => {
    if (!logOpen || !selectedRun) return;
    let active = true;
    const load = () => {
      setLogLoading(true);
      getPipelineRunLog(selectedRun.id, logFile)
        .then(text => { if (active) setLogText(text || t('runs.logEmpty')); })
        .catch(() => { if (active) setLogText(t('runs.logEmpty')); })
        .finally(() => { if (active) setLogLoading(false); });
    };
    load();
    const interval = isRunActive(selectedRun) ? window.setInterval(load, 5000) : undefined;
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
    };
  }, [logOpen, logFile, selectedRun?.id, selectedRun?.status]);

  // Opening the modal or switching log file starts at the tail again — the
  // interesting part of a pipeline log is always the end.
  useEffect(() => {
    if (logOpen) followTail.current = true;
  }, [logOpen, logFile, selectedRun?.id]);

  // Pin to the bottom after each render that changed the text. Layout effect
  // isn't needed: <pre> content is already measured by the time this runs.
  useEffect(() => {
    const el = logRef.current;
    if (!el || !followTail.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logText, logOpen]);

  const handleLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    // 24px of slack so a near-bottom position still counts as following —
    // fractional scroll heights never land exactly on the boundary.
    followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
  }, []);

  const sections = useMemo(() => {
    if (!selectedRun?.manifest) return [];
    const order = selectedRun.sections || [];
    const grouped = new Map<string, ManifestEntry[]>();
    for (const entry of selectedRun.manifest) {
      const list = grouped.get(entry.section) || [];
      list.push(entry);
      grouped.set(entry.section, list);
    }
    const known = order.filter(s => grouped.has(s));
    const unknown = Array.from(grouped.keys()).filter(s => !order.includes(s));
    return [...known, ...unknown].map(section => ({ section, files: grouped.get(section)! }));
  }, [selectedRun?.manifest, selectedRun?.sections]);

  const togglePath = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSection = (files: ManifestEntry[]) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      const allSelected = files.every(f => next.has(f.path));
      files.forEach(f => (allSelected ? next.delete(f.path) : next.add(f.path)));
      return next;
    });
  };

  const doDownload = async (key: string, action: () => Promise<void>) => {
    setDownloading(key);
    try {
      await action();
    } catch {
      showToast(t('errors.downloadFailed'), 'error');
    } finally {
      setDownloading(null);
    }
  };

  const zipName = (suffix: string) =>
    selectedRun ? `${selectedRun.pipeline}_${selectedRun.variant}_run${selectedRun.id}_${suffix}.zip` : 'outputs.zip';

  const handleDeleteRun = (run: PipelineRun) => {
    if (!window.confirm(t('runs.confirmDelete', { id: run.id }))) return;
    deletePipelineRun(run.id)
      .then(() => { showToast(t('runs.deleted'), 'success'); onChanged(); })
      .catch((err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        showToast(detail || t('errors.actionFailed'), 'error');
      });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">{triggerControls}</div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Run history */}
        <Card className="xl:col-span-1">
          <CardBody className="space-y-1 p-3">
            <div className="px-2 pb-2 font-display text-sm font-bold text-ink">
              {t('runs.historyTitle')}
            </div>
            {runs.length === 0 && (
              <EmptyState title={t('runs.emptyTitle')} description={t('runs.emptyDescription')} />
            )}
            {runs.map(run => (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ' +
                  (selectedRun?.id === run.id
                    ? 'border-coral-300 bg-coral-50 dark:bg-coral-500/10'
                    : 'border-transparent hover:bg-surface-sunken')
                }
              >
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-bold text-ink">#{run.id}</span>
                  {variantLabels && (
                    <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">
                      {variantLabels[run.variant] || run.variant}
                    </span>
                  )}
                  <Badge variant={statusBadgeVariant(run.status)} size="sm">
                    {t(`status.${run.status}`)}
                  </Badge>
                  {isRunActive(run) && <Spinner className="size-3.5" />}
                  <span className="ml-auto text-xs tabular-nums text-ink-muted">{runDuration(run)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-muted">
                  <span className="truncate">{run.label || formatWhen(run.created_at)}</span>
                  <span className="shrink-0 tabular-nums">{t('runs.fileCount', { n: run.file_count })}</span>
                </div>
              </button>
            ))}
          </CardBody>
        </Card>

        {/* Selected run detail + outputs */}
        <div className="space-y-4 xl:col-span-2">
          {!selectedRun && !selectedLoading && (
            <EmptyState
              icon={<PlayCircle className="size-8" />}
              title={t('runs.noSelectionTitle')}
              description={t('runs.noSelectionDescription')}
            />
          )}
          {selectedLoading && !selectedRun && (
            <div className="flex justify-center p-8"><Spinner className="size-6" /></div>
          )}
          {selectedRun && (
            <>
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-base font-extrabold text-ink">
                      {t('runs.runTitle', { id: selectedRun.id })}
                    </span>
                    <Badge variant={statusBadgeVariant(selectedRun.status)}>
                      {t(`status.${selectedRun.status}`)}
                    </Badge>
                    {selectedRun.label && (
                      <span className="text-xs text-ink-muted">{selectedRun.label}</span>
                    )}
                    <span className="ml-auto" />
                    <Button
                      variant="outline" size="sm"
                      iconLeft={<ScrollText className="size-4" />}
                      onClick={() => { setLogFile('console'); setLogOpen(true); }}
                    >
                      {t('runs.viewLog')}
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      iconLeft={<Archive className="size-4" />}
                      loading={downloading === 'all'}
                      disabled={!selectedRun.manifest?.length}
                      onClick={() => void doDownload('all',
                        () => downloadRunZip(selectedRun.id, {}, zipName('all_outputs')))}
                    >
                      {t('runs.downloadAll')}
                    </Button>
                    {!isRunActive(selectedRun) && (
                      <Button
                        variant="ghost" size="sm"
                        title={t('runs.deleteRun')}
                        onClick={() => handleDeleteRun(selectedRun)}
                      >
                        <Trash2 className="size-4 text-error-600" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted sm:grid-cols-4">
                    <div>{t('runs.started')}: <span className="tabular-nums">{formatWhen(selectedRun.started_at)}</span></div>
                    <div>{t('runs.duration')}: <span className="tabular-nums">{runDuration(selectedRun)}</span></div>
                    <div>{t('runs.files')}: <span className="tabular-nums">{selectedRun.file_count}</span></div>
                    <div className="truncate">{t('runs.by')}: {selectedRun.created_by || '—'}</div>
                  </div>
                  {selectedRun.error && (
                    <div className="rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
                      {selectedRun.error}
                    </div>
                  )}
                  {(() => {
                    const validation = (selectedRun.report as { validation?: Record<string, string> })?.validation;
                    if (!validation || !validation.Verdict) return null;
                    return (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
                        <span className="font-semibold text-ink">
                          {t('runs.validation')}: {' '}
                          <span className={validation.Verdict === 'PASS' ? 'text-success-600' : 'text-error-600'}>
                            {validation.Verdict}
                          </span>
                        </span>
                        {validation['Workbooks scanned'] && <span>{t('runs.workbooks')}: {validation['Workbooks scanned']}</span>}
                        {validation['Tables checked'] && <span>{t('runs.tables')}: {validation['Tables checked']}</span>}
                        {validation.UNEXPLAINED && <span>{t('runs.unexplained')}: {validation.UNEXPLAINED}</span>}
                      </div>
                    );
                  })()}
                  {isRunActive(selectedRun) && (
                    <div className="flex items-center gap-2 text-sm text-ink-muted">
                      <Spinner className="size-4" />
                      {t('runs.inProgress')}
                    </div>
                  )}
                </CardBody>
              </Card>

              {selectedPaths.size > 0 && (
                <div className="sticky top-2 z-10 flex items-center gap-3 rounded-xl border border-coral-300 bg-coral-50 px-4 py-2.5 shadow-(--shadow-card) dark:bg-coral-500/10">
                  <span className="text-sm font-semibold text-ink">
                    {t('runs.selectedCount', { n: selectedPaths.size })}
                  </span>
                  <Button
                    size="sm" variant="primary"
                    iconLeft={<Archive className="size-4" />}
                    loading={downloading === 'selected'}
                    onClick={() => void doDownload('selected',
                      () => downloadRunZip(selectedRun.id, { paths: Array.from(selectedPaths) }, zipName('selected')))}
                  >
                    {t('runs.downloadSelected')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedPaths(new Set())}>
                    {t('runs.clearSelection')}
                  </Button>
                </div>
              )}

              {sections.map(({ section, files }) => {
                // Requested-CTs sections: only the summary workbook shows until
                // the admin unhides the individual tables.
                const collapsible = section.startsWith('Requested CTs');
                const expanded = expandedSections.has(section);
                let shownFiles = files;
                if (collapsible && !expanded) {
                  const summary = files.filter(f =>
                    f.name.toLowerCase().startsWith('custom_report_tables'));
                  if (summary.length > 0) shownFiles = summary;
                }
                const hiddenCount = files.length - shownFiles.length;
                return (
                <Card key={section}>
                  <CardBody className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={files.every(f => selectedPaths.has(f.path))}
                        onChange={() => toggleSection(files)}
                      />
                      <span className="font-display text-sm font-bold text-ink">{section}</span>
                      <span className="text-xs text-ink-muted">({files.length})</span>
                      <span className="ml-auto" />
                      <Button
                        variant="ghost" size="sm"
                        iconLeft={<Archive className="size-4" />}
                        loading={downloading === `section:${section}`}
                        onClick={() => void doDownload(`section:${section}`,
                          () => downloadRunZip(selectedRun.id, { section }, zipName(section.replace(/[^A-Za-z0-9]+/g, '_'))))}
                      >
                        {t('runs.downloadSection')}
                      </Button>
                    </div>
                    <Table density="compact">
                      <THead>
                        <Tr>
                          <Th> </Th>
                          <Th>{t('runs.colFile')}</Th>
                          <Th>{t('runs.colSize')}</Th>
                          <Th> </Th>
                        </Tr>
                      </THead>
                      <TBody>
                        {shownFiles.map(file => (
                          <Tr key={file.path}>
                            <Td>
                              <Checkbox
                                checked={selectedPaths.has(file.path)}
                                onChange={() => togglePath(file.path)}
                              />
                            </Td>
                            <Td>
                              <span className="flex items-center gap-2">
                                <FileText className="size-4 shrink-0 text-ink-faint" />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-ink">{file.name}</span>
                                  {file.path !== file.name && (
                                    <span className="block truncate text-[11px] text-ink-faint">{file.path}</span>
                                  )}
                                </span>
                              </span>
                            </Td>
                            <Td className="tabular-nums">{formatBytes(file.size)}</Td>
                            <Td>
                              <Button
                                variant="ghost" size="sm"
                                title={t('runs.downloadFile')}
                                loading={downloading === `file:${file.path}`}
                                onClick={() => void doDownload(`file:${file.path}`,
                                  () => downloadRunFile(selectedRun.id, file.path))}
                              >
                                <Download className="size-4" />
                              </Button>
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                    {collapsible && (hiddenCount > 0 || expanded) && (
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 text-xs font-semibold text-ink-muted hover:border-coral-500 hover:text-coral-600 dark:hover:text-coral-300"
                        onClick={() =>
                          setExpandedSections(prev => {
                            const next = new Set(prev);
                            if (expanded) next.delete(section);
                            else next.add(section);
                            return next;
                          })
                        }
                      >
                        {expanded ? (
                          <><EyeOff className="size-3.5" /> {t('runs.hideIndividual')}</>
                        ) : (
                          <><Eye className="size-3.5" /> {t('runs.showHidden', { n: hiddenCount })}</>
                        )}
                      </button>
                    )}
                  </CardBody>
                </Card>
                );
              })}
            </>
          )}
        </div>
      </div>

      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title={t('runs.logTitle', { id: selectedRun?.id ?? '' })}
        size="2xl"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {(['console', 'pipeline', 'report'] as const).map(key => (
              <Button
                key={key}
                size="sm"
                variant={logFile === key ? 'primary' : 'outline'}
                onClick={() => setLogFile(key)}
              >
                {t(`runs.logFiles.${key}`)}
              </Button>
            ))}
            {logLoading && <Spinner className="size-4" />}
          </div>
          <pre
            ref={logRef}
            onScroll={handleLogScroll}
            className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-ink"
          >
            {logText}
          </pre>
        </div>
      </Modal>
    </div>
  );
};

export default RunsPanel;
