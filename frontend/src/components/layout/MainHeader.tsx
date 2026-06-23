import React from 'react';
import { Menu, Sun, Moon, Bell } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

interface MainHeaderProps {
  title: string;
  onToggleSidebar: () => void;
  onToggleNotifs: () => void;
  unreadNotifsCount: number;
}

const MainHeader: React.FC<MainHeaderProps> = ({
  title,
  onToggleSidebar,
  onToggleNotifs,
  unreadNotifsCount,
}) => {
  const { darkMode, toggleDarkMode } = useTheme();
  const { user } = useAuth();

  return (
    <header className="main-header" style={{ position: 'sticky', top: 0, zIndex: 'var(--z-dropdown)' }}>
      {/* Left side: Hamburger (Mobile) + Screen Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button
          className="sidebar-toggle-btn"
          onClick={onToggleSidebar}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Menu size={24} />
        </button>
        <h1 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
          {title}
        </h1>
      </div>

      {/* Right side: Actions & User avatar */}
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Dark Mode Toggle */}
        <button
          onClick={toggleDarkMode}
          className="header-action-btn"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', width: '38px', height: '38px' }}
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        {/* Notifications Bell */}
        <button
          onClick={onToggleNotifs}
          className="header-action-btn"
          style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', width: '38px', height: '38px' }}
          title="Notifications"
        >
          <Bell size={20} />
          {unreadNotifsCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                width: '18px',
                height: '18px',
                backgroundColor: 'var(--error-500)',
                color: 'white',
                borderRadius: '50%',
                fontSize: '0.6875rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 0 2px var(--bg-secondary)',
              }}
            >
              {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
            </span>
          )}
        </button>

        {/* User initials block */}
        {user && (
          <div
            className="avatar avatar-sm font-display"
            style={{
              cursor: 'pointer',
              boxShadow: '0 0 0 2px var(--primary-500)',
              backgroundColor: 'var(--primary-100)',
              color: 'var(--primary-800)',
            }}
          >
            {user.avatar_initials || 'U'}
          </div>
        )}
      </div>
    </header>
  );
};

export default MainHeader;
