import React from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Sun, Moon, Bell } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui';
import LanguageSwitcher from '../LanguageSwitcher';

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
  const { t } = useTranslation(['app', 'common']);
  const { darkMode, toggleDarkMode } = useTheme();
  const { user } = useAuth();

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

      {/* Right: actions + avatar — never shrinks, they are all tap targets. */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <LanguageSwitcher variant="compact" />

        <button
          onClick={toggleDarkMode}
          className={iconBtn}
          title={darkMode ? t('common:theme.light') : t('common:theme.dark')}
        >
          {darkMode ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>

        <button onClick={onToggleNotifs} className={`${iconBtn} relative`} title={t('app:header.notifications')}>
          <Bell className="size-5" />
          {unreadNotifsCount > 0 && (
            <span className="absolute right-1 top-1 flex size-4.5 items-center justify-center rounded-full bg-error-500 text-[11px] font-bold text-white ring-2 ring-surface">
              {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
            </span>
          )}
        </button>

        {user && (
          <Avatar
            name={user.full_name || 'User'}
            size="sm"
            className="ring-2 ring-primary cursor-pointer"
          />
        )}
      </div>
    </header>
  );
};

export default MainHeader;
