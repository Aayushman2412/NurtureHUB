import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Info } from 'lucide-react';
import { Button, Modal } from '../ui';
import { cn } from '../../utils/cn';
import { guideKeyFor, guideTerms } from '../../lib/pageGuide';

/**
 * "Guide to this page" (review of 5 Oct 2026): every admin page explains its
 * own abbreviations and measures — FT, ST, BFA, EC, risk score … — from the
 * same fixed place, the top of the side menu (the header on a phone), so
 * someone new to the programme can read any dashboard. Downloadable too.
 */
const PageGuide: React.FC<{ variant: 'sidebar' | 'header' }> = ({ variant }) => {
  const { t } = useTranslation('guide');
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const page = guideKeyFor(pathname);
  if (!page) return null;
  const name = t(`pages.${page}.name`);
  const terms = guideTerms(t, page);

  const download = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      [t('title', { page: name })],
      [t(`pages.${page}.intro`)],
      [],
      [t('termCol'), t('meaningCol')],
      ...terms.map(x => [x.term, x.meaning]),
    ]);
    ws['!cols'] = [{ wch: 34 }, { wch: 110 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
    XLSX.writeFile(wb, `guide_${page}.xlsx`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('button')}
        aria-label={t('button')}
        className={cn(
          'inline-flex cursor-pointer items-center gap-2 rounded-xl font-semibold transition-colors',
          variant === 'sidebar'
            ? 'w-full border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary-ink hover:bg-primary/15'
            : 'size-10 justify-center text-primary-ink hover:bg-surface-sunken',
        )}
      >
        <Info className={variant === 'sidebar' ? 'size-4.5 shrink-0' : 'size-5'} />
        {variant === 'sidebar' && <span className="truncate">{t('button')}</span>}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('title', { page: name })}
        size="lg"
        footer={(
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button variant="outline" iconLeft={<Download className="size-4" />} onClick={() => void download()}>
              {t('download')}
            </Button>
            <Button onClick={() => setOpen(false)}>{t('close')}</Button>
          </div>
        )}
      >
        <p className="mb-4 text-base text-ink">{t(`pages.${page}.intro`)}</p>
        <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {terms.map(x => (
            <div key={x.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
              <dt className="font-bold text-ink">{x.term}</dt>
              <dd className="text-ink">{x.meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-ink-muted">{t('everyPage')}</p>
      </Modal>
    </>
  );
};

export default PageGuide;
