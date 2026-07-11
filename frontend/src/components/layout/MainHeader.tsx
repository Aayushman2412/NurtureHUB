import React from 'react';
import { Menu, Sun, Moon, Bell } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui';

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
  const { darkMode, toggleDarkMode } = useTheme();
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-(--z-dropdown) flex items-center justify-between gap-4 border-b border-border bg-surface/85 px-5 py-3 backdrop-blur-md print:hidden">
      {/* Left: hamburger (mobile) + title */}
      <div className="flex items-center gap-3">
        <button onClick={onToggleSidebar} className={`${iconBtn} lg:hidden`} aria-label="Toggle menu">
          <Menu className="size-6" />
        </button>
        <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
      </div>

      {/* Right: actions + avatar */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleDarkMode}
          className={iconBtn}
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {darkMode ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>

        <button onClick={onToggleNotifs} className={`${iconBtn} relative`} title="Notifications">
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
