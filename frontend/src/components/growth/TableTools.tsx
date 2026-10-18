import React from 'react';
import { useTranslation } from 'react-i18next';
import { ImageDown, Smartphone } from 'lucide-react';
import { downloadTablePng, slugify } from '../../lib/chartExport';

/** "Save as picture" for the table inside `target` (review of 18 Oct 2026:
 *  "make those tables into a downloadable image so that they can open and
 *  zoom"). */
export const TablePictureButton: React.FC<{ target: React.RefObject<HTMLElement | null>; title: string }> = ({ target, title }) => {
  const { t } = useTranslation('growth');
  return (
    <button
      type="button"
      onClick={() => {
        const table = target.current?.querySelector('table');
        if (table) downloadTablePng(table, `${slugify(title)}.png`, title);
      }}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <ImageDown className="size-3.5" />{t('casePage.savePicture')}
    </button>
  );
};

/** Only on a phone held upright: wide tables and charts read better sideways
 *  (review of 18 Oct 2026: "we need to have an indicator — turn the phone"). */
export const RotateHint: React.FC = () => {
  const { t } = useTranslation('growth');
  return (
    <p className="hidden items-center gap-1.5 text-xs font-semibold text-amber-700 max-sm:portrait:flex dark:text-amber-300">
      <Smartphone className="size-3.5 rotate-90" />{t('casePage.rotateHint')}
    </p>
  );
};
