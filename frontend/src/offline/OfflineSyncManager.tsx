import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { startSyncTriggers, SYNC_AUTH_EVENT, SYNC_DONE_EVENT } from './sync';

/**
 * Headless component: arms the global sync triggers once and surfaces sync
 * outcomes as toasts. Mounted inside the provider tree so useToast works.
 */
const OfflineSyncManager: React.FC = () => {
  const { t } = useTranslation('offline');
  const { showToast } = useToast();

  useEffect(() => {
    startSyncTriggers();

    const onDone = (event: Event) => {
      const detail = (event as CustomEvent<{ synced: number; failed: number }>).detail;
      if (detail?.synced > 0) showToast(t('syncedToast', { n: detail.synced }), 'success');
      if (detail?.failed > 0) showToast(t('syncFailedToast', { n: detail.failed }), 'warning');
    };
    let authToastShown = false;
    const onAuth = () => {
      if (authToastShown) return;
      authToastShown = true;
      showToast(t('authRequired'), 'warning');
    };
    window.addEventListener(SYNC_DONE_EVENT, onDone);
    window.addEventListener(SYNC_AUTH_EVENT, onAuth);
    return () => {
      window.removeEventListener(SYNC_DONE_EVENT, onDone);
      window.removeEventListener(SYNC_AUTH_EVENT, onAuth);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

export default OfflineSyncManager;
