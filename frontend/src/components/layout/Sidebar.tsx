import React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LayoutDashboard, Video, Award, User, LogOut, Sprout, Users, Activity } from 'lucide-react';
import { Avatar } from '../ui';
import { cn } from '../../utils/cn';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/tutorials', labelKey: 'nav.tutorials', icon: Video },
  { to: '/tests', labelKey: 'nav.assessments', icon: Award },
  { to: '/mothers', labelKey: 'nav.mothers', icon: Users },
  { to: '/growth', labelKey: 'nav.growth', icon: Activity },
  { to: '/profile', labelKey: 'nav.profile', icon: User },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation(['app', 'common']);
  const { user, logout } = useAuth();

  return (
    <>
      {/* Mobile overlay */}
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-(--z-sidebar) bg-cream-950/40 backdrop-blur-xs transition-opacity lg:hidden print:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-(--z-sidebar) flex w-64 flex-col border-r border-border bg-surface',
          'transition-transform duration-300 lg:translate-x-0 print:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex-1 overflow-y-auto">
          {/* Brand */}
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-coral-400 to-coral-600">
              <Sprout className="size-5 text-white" />
            </span>
            <span className="font-display text-lg font-extrabold">{t('common:brand.name')}</span>
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-1 p-3">
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-coral-50 text-primary dark:bg-coral-500/10'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )
                }
              >
                <item.icon className="size-[18px]" />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User footer */}
        {user && (
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-3">
              <Avatar name={user.full_name || t('app:user.fallbackName')} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{user.full_name || t('app:user.fallbackName')}</div>
                <div className="truncate text-xs text-ink-muted">{user.role || t('app:user.defaultRole')}</div>
              </div>
              <button
                onClick={logout}
                title={t('app:user.signOut')}
                className="flex size-8 items-center justify-center rounded-lg text-ink-muted
                           hover:bg-surface-sunken hover:text-ink cursor-pointer"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
