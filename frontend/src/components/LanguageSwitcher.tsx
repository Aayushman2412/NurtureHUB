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

  // Compact collapses to a globe-only circle on a phone: spelled out it costs
  // 115px of a 375px header, which is what pushed the whole control group
  // off-screen. The language is still one tap away and the dropdown names it.
  const triggerClass =
    variant === 'compact'
      ? 'inline-flex size-9.5 items-center justify-center rounded-full border border-border bg-surface text-sm font-semibold text-ink-muted hover:text-ink transition-colors cursor-pointer sm:size-auto sm:gap-1.5 sm:px-3 sm:py-1.5'
      : 'inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink-muted hover:text-ink transition-colors cursor-pointer';

  return (
    <Dropdown
      trigger={open => (
        <button type="button" className={triggerClass} aria-label={t('language.select')}>
          <Globe className="size-4 shrink-0" />
          <span className={variant === 'compact' ? 'hidden sm:inline' : undefined}>{current.native}</span>
          <ChevronDown
            className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${
              variant === 'compact' ? 'hidden sm:inline' : ''
            }`}
          />
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
