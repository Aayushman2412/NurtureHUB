import { useEffect, useState } from 'react';
import { listOwnQueue, OFFLINE_CHANGED_EVENT } from './queue';
import { SYNC_DONE_EVENT } from './sync';
import type { QueueItem } from './db';

/** Live view of the offline queue + connectivity, for badges and lists. */
export function usePendingSync() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    let active = true;
    const reload = () => {
      void listOwnQueue().then(list => {
        if (active) setItems(list);
      });
    };
    reload();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener(OFFLINE_CHANGED_EVENT, reload);
    window.addEventListener(SYNC_DONE_EVENT, reload);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      active = false;
      window.removeEventListener(OFFLINE_CHANGED_EVENT, reload);
      window.removeEventListener(SYNC_DONE_EVENT, reload);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return { items, count: items.length, online };
}
