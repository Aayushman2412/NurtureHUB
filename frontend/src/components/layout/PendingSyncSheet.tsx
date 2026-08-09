import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CloudUpload, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, Modal } from '../ui';
import { usePendingSync } from '../../offline/usePendingSync';
import { countDependents, removeItem } from '../../offline/queue';
import { ERR_MEDIA_LOST, retryItem, syncQueue } from '../../offline/sync';
import type { QueueItem } from '../../offline/db';

interface PendingSyncSheetProps {
  open: boolean;
  onClose: () => void;
}

const kindKey: Record<QueueItem['kind'], string> = {
  media: 'kind.media',
  mother: 'kind.mother',
  child: 'kind.child',
  response_create: 'kind.response',
  response_update: 'kind.response',
};

/** Lists records captured offline and their sync state (retry / discard). */
const PendingSyncSheet: React.FC<PendingSyncSheetProps> = ({ open, onClose }) => {
  const { t } = useTranslation('offline');
  const { items, online } = usePendingSync();
  const [busy, setBusy] = useState(false);

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      await syncQueue();
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async (item: QueueItem) => {
    // Discarding a never-synced mother/child also discards what was captured
    // under it (a child of a discarded offline mother can never sync) — the
    // learner must know that before confirming.
    const dependents = item.kind === 'media' ? 0 : await countDependents(item);
    const message = dependents > 0
      ? t('discardCascadeConfirm', { label: item.label, n: dependents })
      : t('discardConfirm', { label: item.label });
    if (!window.confirm(message)) return;
    void removeItem(item.id);
  };

  /** Sentinel errors are translated; raw server details pass through. */
  const errorText = (item: QueueItem): string | undefined => {
    if (item.blockedBy) return t('blockedBy', { label: item.blockedBy });
    if (item.error === ERR_MEDIA_LOST) return t('mediaLost');
    return item.error;
  };

  return (
    <Modal open={open} onClose={onClose} title={t('sheetTitle')} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={online ? 'success' : 'warning'}>
            {online ? t('online') : t('offline')}
          </Badge>
          <span className="text-xs text-ink-muted">{t('sheetHint')}</span>
          <span className="ml-auto" />
          <Button
            size="sm"
            variant="primary"
            iconLeft={<RefreshCw className="size-4" />}
            loading={busy}
            disabled={!online || items.length === 0}
            onClick={() => void handleSyncNow()}
          >
            {t('syncNow')}
          </Button>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={<CloudUpload className="size-8" />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map(item => (
              <li key={item.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{item.label}</span>
                    <Badge variant="neutral" size="sm">{t(kindKey[item.kind])}</Badge>
                    {item.status === 'failed' && (
                      <Badge variant="error" size="sm">{t('failed')}</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                  {item.status === 'failed' && errorText(item) && (
                    <div className="mt-1 flex items-start gap-1.5 text-xs text-error-600">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{errorText(item)}</span>
                    </div>
                  )}
                </div>
                {item.status === 'failed' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => void retryItem(item)}>
                      {t('retry')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('discard')}
                      onClick={() => void handleDiscard(item)}
                    >
                      <Trash2 className="size-4 text-error-600" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default PendingSyncSheet;
