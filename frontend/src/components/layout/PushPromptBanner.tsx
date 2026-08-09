import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, X } from 'lucide-react';
import { Button } from '../ui';
import { useToast } from '../../context/ToastContext';
import { dismissPushPrompt, enablePush, shouldOfferPush } from '../../pushClient';

/**
 * One-time banner offering system notifications. Only rendered in phone /
 * installed-app contexts (desktop keeps the notifications tab, undisturbed).
 */
const PushPromptBanner: React.FC = () => {
  const { t } = useTranslation('offline');
  const { showToast } = useToast();
  const [visible, setVisible] = useState(shouldOfferPush);
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const ok = await enablePush();
      showToast(ok ? t('pushEnabled') : t('pushNotEnabled'), ok ? 'success' : 'info');
    } catch {
      showToast(t('pushNotEnabled'), 'error');
    } finally {
      setBusy(false);
      setVisible(false);
    }
  };

  const handleDismiss = () => {
    dismissPushPrompt();
    setVisible(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-coral-200 bg-coral-50 px-4 py-2.5 dark:border-coral-500/30 dark:bg-coral-500/10 print:hidden">
      <BellRing className="size-4.5 shrink-0 text-primary-ink" />
      <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
        {t('pushPrompt')}
      </span>
      <Button size="sm" variant="primary" loading={busy} onClick={() => void handleEnable()}>
        {t('pushEnable')}
      </Button>
      <button
        onClick={handleDismiss}
        aria-label={t('pushDismiss')}
        className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
      >
        <X className="size-4" />
      </button>
    </div>
  );
};

export default PushPromptBanner;
