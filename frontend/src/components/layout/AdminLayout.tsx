import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, FileText, Video, ClipboardList, LogOut, Shield, MapPin, ChevronDown, Building2, Sun, Moon,
  MonitorPlay, GraduationCap, Radio, Activity, Table2, FileSpreadsheet, Menu,
} from 'lucide-react';
import client from '../../api/client';
import { clearOfflineCaches } from '../../pwa';
import { useTheme } from '../../context/ThemeContext';
import { Avatar, Dropdown } from '../ui';
import { cn } from '../../utils/cn';

interface AdminLayoutProps {
  children: React.ReactNode;
}

interface ProgramDistrict {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  user_count: number;
}

const navItems = [
  { to: '/admin', icon: LayoutDashboard, key: 'dashboard', end: true },
  { to: '/admin/districts', icon: Building2, key: 'districts', end: false },
  { to: '/admin/form-builder', icon: FileText, key: 'formBuilder', end: false },
  { to: '/admin/tutorials', icon: Video, key: 'tutorials', end: false },
  { to: '/admin/tutorial-tracking', icon: MonitorPlay, key: 'tutorialTracking', end: false },
  { to: '/admin/tests', icon: ClipboardList, key: 'testManager', end: false },
  { to: '/admin/tests', icon: Radio, key: 'liveMonitor', end: false },
  { to: '/admin/results', icon: GraduationCap, key: 'results', end: false },
  { to: '/admin/growth', icon: Activity, key: 'growthMonitor', end: false },
] as const;

// "Database" section — the data-analytics pipelines (admin-run crosstabs/MASD).
const databaseNavItems = [
  { to: '/admin/database/crosstabs', icon: Table2, key: 'crosstabsPipeline', end: false },
  { to: '/admin/database/masd', icon: FileSpreadsheet, key: 'masdPipeline', end: false },
] as const;

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('admin');
  const { darkMode, toggleDarkMode } = useTheme();

  // Below lg the sidebar is a slide-in drawer (same pattern as the learner
  // Sidebar); on desktop it is pinned open and this state is ignored.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [districts, setDistricts] = useState<ProgramDistrict[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>(localStorage.getItem('nh_admin_district') || '');

  const loadDistricts = () => {
    client
      .get('/api/admin/districts')
      .then(res => {
        setDistricts(res.data);
        if (!selectedSlug && res.data.length > 0) {
          const first = res.data[0].slug;
          setSelectedSlug(first);
          localStorage.setItem('nh_admin_district', first);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadDistricts();

    // Keep switcher updated on district changes
    const handleDistrictChange = () => {
      const current = localStorage.getItem('nh_admin_district') || '';
      setSelectedSlug(current);
      loadDistricts();
    };
    window.addEventListener('district-changed', handleDistrictChange);

    return () => {
      window.removeEventListener('district-changed', handleDistrictChange);
    };
  }, [selectedSlug]);

  const handleSwitchDistrict = (slug: string) => {
    setSelectedSlug(slug);
    localStorage.setItem('nh_admin_district', slug);
    window.dispatchEvent(new Event('district-changed'));
  };

  const handleLogout = () => {
    localStorage.removeItem('nh_admin');
    localStorage.removeItem('nh_admin_token');
    localStorage.removeItem('nh_admin_name');
    localStorage.removeItem('nh_admin_district');
    void clearOfflineCaches();
    navigate('/login');
  };

  const adminName = localStorage.getItem('nh_admin_name') || t('layout.adminFallback');
  const selectedDistrict = districts.find(d => d.slug === selectedSlug);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile overlay */}
      <div
        onClick={() => setSidebarOpen(false)}
        className={cn(
          'fixed inset-0 z-(--z-sidebar) bg-cream-950/40 backdrop-blur-xs transition-opacity lg:hidden print:hidden',
          sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden
      />

      {/* Sidebar — same coral identity as the member app; drawer below lg */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-(--z-sidebar) flex w-64 flex-col border-r border-border bg-surface',
          'transition-transform duration-300 lg:translate-x-0 print:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-coral-400 to-coral-600 text-white">
            <Shield className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-display text-base font-extrabold leading-tight">NurtureHUB</h2>
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary-ink">
              {t('layout.panel')}
            </span>
          </div>
          <button
            onClick={toggleDarkMode}
            title={t('layout.toggleTheme')}
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
          >
            {darkMode ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </button>
        </div>

        {/* District switcher */}
        <div className="px-3 pt-3">
          <Dropdown
            className="w-full"
            trigger={open => (
              <button
                className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[13px] font-semibold text-ink hover:border-border-strong cursor-pointer"
              >
                <MapPin className="size-4 shrink-0 text-primary-ink" />
                <span className="flex-1 truncate text-left">{selectedDistrict?.name || t('layout.selectDistrict')}</span>
                <ChevronDown className={cn('size-3.5 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
              </button>
            )}
            items={districts.map(d => ({
              key: d.slug,
              selected: d.slug === selectedSlug,
              onSelect: () => handleSwitchDistrict(d.slug),
              label: (
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <MapPin className="size-3.5" />
                    {d.name}
                  </span>
                  <span className="text-[11px] opacity-60">{t('layout.usersCount', { n: d.user_count })}</span>
                </span>
              ),
            }))}
          />
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {navItems.map(item => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-coral-50 text-primary-ink dark:bg-coral-500/10'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )
              }
            >
              <item.icon className="size-[18px]" />
              <span>{t(`layout.nav.${item.key}`)}</span>
            </NavLink>
          ))}

          <div className="px-3.5 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
            {t('layout.nav.databaseSection')}
          </div>
          {databaseNavItems.map(item => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-coral-50 text-primary-ink dark:bg-coral-500/10'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )
              }
            >
              <item.icon className="size-[18px]" />
              <span>{t(`layout.nav.${item.key}`)}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border p-3">
          <Avatar name={adminName} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{adminName}</div>
            <div className="text-xs text-ink-muted">{t('layout.superAdmin')}</div>
          </div>
          <button
            onClick={handleLogout}
            title={t('layout.logout')}
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
          >
            <LogOut className="size-4.5" />
          </button>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-64">
        {/* Mobile top bar: hamburger + brand (the sidebar is a drawer here) */}
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden print:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label={t('layout.openMenu')}
            className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
          >
            <Menu className="size-5" />
          </button>
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-coral-400 to-coral-600 text-white">
            <Shield className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block truncate font-display text-sm font-extrabold text-ink">
              NurtureHUB <span className="text-primary-ink">{t('layout.panel')}</span>
            </span>
          </div>
          <button
            onClick={toggleDarkMode}
            title={t('layout.toggleTheme')}
            className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
          >
            {darkMode ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </button>
        </header>
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
};

export default AdminLayout;
