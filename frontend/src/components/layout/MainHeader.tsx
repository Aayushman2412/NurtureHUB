import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Sun, Moon, Bell, CloudOff, CloudUpload } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import LanguageSwitcher from '../LanguageSwitcher';
import PendingSyncSheet from './PendingSyncSheet';
import InstallAppButton from './InstallAppButton';
import { usePendingSync } from '../../offline/usePendingSync';

interface MainHeaderProps {
  title: string;
  onToggleSidebar: () => void;
  onToggleNotifs: () => void;
  unreadNotifsCount: number;
}

const iconBtn =
  'flex size-9.5 items-center justify-center rounded-full text-ink-muted transition-colors ' +
  'hover:bg-surface-sunken hover:text-ink cursor-pointer';

const MainHeader: React.FC<MainHeaderProps> = ({
  title,
  onToggleSidebar,
  onToggleNotifs,
  unreadNotifsCount,
}) => {
  const { t } = useTranslation(['app', 'common', 'offline']);
  const { darkMode, toggleDarkMode } = useTheme();
  const { count: pendingCount, online } = usePendingSync();
  const [syncSheetOpen, setSyncSheetOpen] = useState(false);

  return (
    <header className="sticky top-0 z-(--z-dropdown) flex items-center justify-between gap-2 border-b border-border bg-surface/85 px-4 py-3 backdrop-blur-md sm:gap-4 sm:px-5 print:hidden">
      {/* Left: hamburger (mobile) + title. `min-w-0` + `truncate` make the TITLE
          the thing that gives way when space runs out — without them the flex
          row cannot shrink and it pushes the controls off a phone screen. */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button onClick={onToggleSidebar} className={`${iconBtn} shrink-0 lg:hidden`} aria-label={t('app:header.toggleMenu')}>
          <Menu className="size-6" />
        </button>
        <h1 className="truncate font-display text-lg font-bold text-ink sm:text-xl">{title}</h1>
      </div>

      {/* Right: actions — never shrinks, they are all tap targets. (The avatar
          that sat here did nothing; Profile is in the sidebar — 17 Oct 2026.) */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Offline / pending-sync indicator: only visible when it has news. */}
        {(pendingCount > 0 || !online) && (
          <button
            onClick={() => setSyncSheetOpen(true)}
            className={`${iconBtn} relative`}
            title={t('offline:badgeTitle')}
          >
            {online ? (
              <CloudUpload className="size-5 text-amber-600" />
            ) : (
              <CloudOff className="size-5 text-amber-600" />
            )}
            {pendingCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex size-4.5 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-white ring-2 ring-surface">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
        )}
        {/* Install the app (hidden once installed) */}
        <InstallAppButton variant="icon" />

        <LanguageSwitcher variant="compact" />

        {/* Labelled like the language pill beside it (review of 17 Oct 2026:
            an unlabelled sun/moon is not obviously "light or dark"). */}
        <button
          onClick={toggleDarkMode}
          className="inline-flex size-9.5 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-sm font-semibold text-ink-muted transition-colors hover:text-ink sm:size-auto sm:gap-1.5 sm:px-3 sm:py-1.5"
          title={darkMode ? t('common:theme.light') : t('common:theme.dark')}
          aria-label={darkMode ? t('common:theme.light') : t('common:theme.dark')}
        >
          {darkMode ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
          <span className="hidden sm:inline">{t('common:theme.label')}</span>
        </button>

        <button onClick={onToggleNotifs} className={`${iconBtn} relative`} title={t('app:header.notifications')}>
          <Bell className="size-5" />
          {unreadNotifsCount > 0 && (
            <span className="absolute right-1 top-1 flex size-4.5 items-center justify-center rounded-full bg-error-500 text-[12px] font-bold text-white ring-2 ring-surface">
              {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
            </span>
          )}
        </button>

      </div>

      <PendingSyncSheet open={syncSheetOpen} onClose={() => setSyncSheetOpen(false)} />
    </header>
  );
};

export default MainHeader;
