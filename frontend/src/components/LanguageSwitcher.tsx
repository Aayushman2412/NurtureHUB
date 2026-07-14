import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown } from 'lucide-react';
import { Dropdown } from './ui';
import { SUPPORTED_LANGUAGES } from '../i18n';

interface LanguageSwitcherProps {
  /** 'pill' = bordered pill (auth screens); 'compact' = icon-first, for headers. */
  variant?: 'pill' | 'compact';
}

/** Global language switcher — persists the choice (localStorage) via i18next. */
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'pill' }) => {
  const { t, i18n } = useTranslation('common');
  const current =
    SUPPORTED_LANGUAGES.find(l => l.code === i18n.resolvedLanguage) ?? SUPPORTED_LANGUAGES[0];

  const triggerClass =
    variant === 'compact'
      ? 'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink-muted hover:text-ink transition-colors cursor-pointer'
      : 'inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink-muted hover:text-ink transition-colors cursor-pointer';

  return (
    <Dropdown
      trigger={open => (
        <button type="button" className={triggerClass} aria-label={t('language.select')}>
          <Globe className="size-4" />
          {current.native}
          <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      items={SUPPORTED_LANGUAGES.map(lang => ({
        key: lang.code,
        selected: lang.code === current.code,
        label: (
          <span className="flex w-full items-center justify-between gap-4">
            {lang.label}
            <span className="text-xs opacity-60">{lang.native}</span>
          </span>
        ),
        onSelect: () => i18n.changeLanguage(lang.code),
      }))}
    />
  );
};

export default LanguageSwitcher;
