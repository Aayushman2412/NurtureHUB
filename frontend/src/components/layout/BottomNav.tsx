import React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { GraduationCap, House, User, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../utils/cn';
import { hasBottomNav } from '../../lib/bottomNav';

/**
 * The phone's main menu (launch review of 19 Oct 2026: the next demo is on the
 * phone, and a worker should not hunt through a side menu). Four places, big
 * targets, at the thumb: Home, Mothers, Training, Profile.
 */
const BottomNav: React.FC = () => {
  const { t } = useTranslation('app');
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!hasBottomNav(pathname)) return null;
  const items = [
    { to: '/dashboard', label: t('bottomNav.home'), icon: House, also: [] as string[] },
    ...(user?.adoptions_open ? [{ to: '/mothers', label: t('bottomNav.mothers'), icon: Users, also: ['/babies'] }] : []),
    { to: '/tutorials', label: t('bottomNav.training'), icon: GraduationCap, also: ['/tests', '/results'] },
    { to: '/profile', label: t('bottomNav.profile'), icon: User, also: [] },
  ];
  return (
    <nav
      aria-label={t('bottomNav.label')}
      className="fixed inset-x-0 bottom-0 z-(--z-dropdown) border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden print:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map(item => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) => cn(
                'flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors',
                isActive || item.also.some(p => pathname.startsWith(p)) ? 'text-primary-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-8 w-14 items-center justify-center rounded-full',
                    (isActive || item.also.some(p => pathname.startsWith(p))) && 'bg-coral-50 dark:bg-coral-500/15')}>
                    <item.icon className="size-6" />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default BottomNav;
