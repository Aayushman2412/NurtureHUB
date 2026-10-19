import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Megaphone, RotateCcw } from 'lucide-react';
import client from '../../api/client';
import { getProjectSlug, PROJECT_EVENT } from '../../lib/adminProject';
import { useToast } from '../../context/ToastContext';
import { Button, Card } from '../ui';

interface Announcement { announced_at: string | null; finished_not_selected: number }

/**
 * Announce the face-to-face selection to the whole project (review of 19 Oct
 * 2026). Until it is announced, a learner who finished every video and test
 * is told to wait for the result; once it is, a learner not on the selection
 * list is told she was not selected this time. Selected learners are told when
 * their names are uploaded, as before.
 */
const SelectionAnnouncement: React.FC = () => {
  const { t } = useTranslation('adminResults');
  const { showToast } = useToast();
  const [info, setInfo] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const slug = getProjectSlug();
    if (!slug) return;
    client.get<Announcement>('/api/admin/results/face-to-face/announcement', { params: { district: slug } })
      .then(r => setInfo(r.data))
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(PROJECT_EVENT, load);
    return () => window.removeEventListener(PROJECT_EVENT, load);
  }, [load]);

  const set = async (announce: boolean) => {
    const question = announce
      ? t('announce.confirm', { count: info?.finished_not_selected ?? 0 })
      : t('announce.confirmUndo');
    if (!confirm(question)) return;
    setBusy(true);
    try {
      const r = await client.post('/api/admin/results/face-to-face/announcement',
        { announce, notify: true }, { params: { district: getProjectSlug() } });
      showToast(announce ? t('announce.done', { count: r.data.notified ?? 0 }) : t('announce.undone'), 'success');
      load();
    } catch {
      showToast(t('announce.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!info) return null;
  const announced = !!info.announced_at;
  return (
    <Card accent={announced ? 'sage' : 'amber'} className="mb-4 flex flex-wrap items-center gap-4 p-4">
      <Megaphone className="size-5 shrink-0 text-primary-ink" />
      <div className="min-w-0 flex-1 basis-72 text-sm">
        <p className="font-semibold text-ink">
          {announced
            ? t('announce.announcedOn', { date: new Date(info.announced_at!).toLocaleDateString('en-GB') })
            : t('announce.notYet')}
        </p>
        <p className="text-ink-muted">
          {announced ? t('announce.announcedBody') : t('announce.notYetBody', { count: info.finished_not_selected })}
        </p>
      </div>
      {announced ? (
        <Button variant="outline" size="sm" loading={busy} iconLeft={<RotateCcw className="size-3.5" />} onClick={() => set(false)}>
          {t('announce.undo')}
        </Button>
      ) : (
        <Button size="sm" loading={busy} iconLeft={<Megaphone className="size-3.5" />} onClick={() => set(true)}>
          {t('announce.button')}
        </Button>
      )}
    </Card>
  );
};

export default SelectionAnnouncement;
