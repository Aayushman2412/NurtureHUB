import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Share, SquarePlus } from 'lucide-react';
import { Button, Modal } from '../ui';
import {
  canPromptInstall, isInstalled, isIos, onInstallStateChange, promptInstall,
} from '../../install';

interface InstallAppButtonProps {
  /** 'button' for a page CTA, 'icon' for the compact header control. */
  variant?: 'button' | 'icon';
  className?: string;
}

/**
 * "Download the app" — installs NurtureHUB as a PWA on phone, laptop or desktop.
 *
 * Chromium (Android/desktop Chrome & Edge) gets the real install prompt. iOS
 * Safari has no such API, so it gets the Share-sheet instructions. Anything
 * else falls back to the same instructions rather than a dead button.
 * Once installed, the control disappears — there is nothing left to do.
 */
const InstallAppButton: React.FC<InstallAppButtonProps> = ({ variant = 'button', className }) => {
  const { t } = useTranslation('app');
  const [installed, setInstalled] = useState(isInstalled());
  const [promptable, setPromptable] = useState(canPromptInstall());
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => {
      setPromptable(canPromptInstall());
      setInstalled(isInstalled());
    };
    const unsubscribe = onInstallStateChange(sync);
    // display-mode flips the moment an installed copy is launched.
    const media = window.matchMedia('(display-mode: standalone)');
    media.addEventListener('change', sync);
    return () => {
      unsubscribe();
      media.removeEventListener('change', sync);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (!promptable) {
      setHelpOpen(true);
      return;
    }
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'unavailable') setHelpOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const ios = isIos();

  return (
    <>
      {variant === 'icon' ? (
        <button
          onClick={() => void handleClick()}
          title={t('install.button')}
          aria-label={t('install.button')}
          className="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
        >
          <Download className="size-5" />
        </button>
      ) : (
        <Button
          variant="secondary"
          iconLeft={<Download className="size-4" />}
          loading={busy}
          onClick={() => void handleClick()}
          className={className}
        >
          {t('install.button')}
        </Button>
      )}

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={t('install.helpTitle')}
        footer={<Button onClick={() => setHelpOpen(false)}>{t('install.gotIt')}</Button>}
      >
        <div className="space-y-4 text-sm text-ink">
          <p className="text-ink-muted">{t('install.helpIntro')}</p>

          {ios ? (
            <ol className="space-y-2.5">
              <li className="flex items-start gap-2.5">
                <Share className="mt-0.5 size-4 shrink-0 text-primary-ink" />
                <span>{t('install.iosStep1')}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <SquarePlus className="mt-0.5 size-4 shrink-0 text-primary-ink" />
                <span>{t('install.iosStep2')}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary-ink" />
                <span>{t('install.iosStep3')}</span>
              </li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-2 pl-5">
              <li>{t('install.otherStep1')}</li>
              <li>{t('install.otherStep2')}</li>
              <li>{t('install.otherStep3')}</li>
            </ol>
          )}

          <p className="rounded-lg bg-surface-sunken px-3 py-2 text-[13px] text-ink-muted">
            {t('install.benefits')}
          </p>
        </div>
      </Modal>
    </>
  );
};

export default InstallAppButton;
