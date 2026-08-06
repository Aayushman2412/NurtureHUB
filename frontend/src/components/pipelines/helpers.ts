import type { PipelineRun } from '../../api/pipelines';

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

export const runDuration = (run: PipelineRun): string => {
  if (!run.started_at) return '—';
  const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - new Date(run.started_at).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export const statusBadgeVariant = (
  status: PipelineRun['status'],
): 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'coral' => {
  switch (status) {
    case 'success': return 'success';
    case 'failed': return 'error';
    case 'running': return 'info';
    case 'queued': return 'warning';
    case 'imported': return 'coral';
    default: return 'neutral';
  }
};

export const isRunActive = (run: PipelineRun): boolean =>
  run.status === 'queued' || run.status === 'running';
