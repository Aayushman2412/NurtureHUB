import React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { GraduationCap, House, Lock, User, Users } from 'lucide-react';
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
    // Always here, locked until selection (review of 29 Oct 2026: "check if
    // adoption is activated will I get the adoption section also here").
    { to: '/mothers', label: t('bottomNav.mothers'), icon: Users, also: ['/babies'], locked: !user?.adoptions_open },
    { to: '/tutorials', label: t('bottomNav.training'), icon: GraduationCap, also: ['/tests', '/results'] },
    { to: '/profile', label: t('bottomNav.profile'), icon: User, also: [] },
  ];
  return (
    <nav
      aria-label={t('bottomNav.label')}
      className="fixed inset-x-0 bottom-0 z-(--z-dropdown) border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map(item => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) => cn(
                // The open tab is marked by a bar along its top edge and a heavier label.
                'flex min-h-16 flex-col items-center justify-center gap-1 border-t-[3px] text-xs transition-colors',
                isActive || item.also.some(p => pathname.startsWith(p))
                  ? 'border-primary font-semibold text-primary-ink'
                  : 'border-transparent font-medium text-ink-muted hover:text-ink',
              )}
            >
              {() => (
                <>
                  <span className="flex items-center justify-center">
                    <item.icon className="size-6" />
                    {'locked' in item && item.locked && (
                      <Lock className="-ml-1.5 mt-3 size-3.5 text-ink-faint" aria-label={t('bottomNav.locked')} />
                    )}
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
