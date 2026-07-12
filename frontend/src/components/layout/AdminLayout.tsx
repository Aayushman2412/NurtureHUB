import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Video, ClipboardList, LogOut, Shield, MapPin, ChevronDown, Building2, Sun, Moon,
  MonitorPlay, GraduationCap, Radio,
} from 'lucide-react';
import client from '../../api/client';
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
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/districts', icon: Building2, label: 'Districts', end: false },
  { to: '/admin/form-builder', icon: FileText, label: 'Form Builder', end: false },
  { to: '/admin/tutorials', icon: Video, label: 'Tutorials', end: false },
  { to: '/admin/tutorial-tracking', icon: MonitorPlay, label: 'Tutorial Tracking', end: false },
  { to: '/admin/tests', icon: ClipboardList, label: 'Test Manager', end: false },
  { to: '/admin/tests', icon: Radio, label: 'Live Monitor', end: false },
  { to: '/admin/results', icon: GraduationCap, label: 'Results', end: false },
];

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const { darkMode, toggleDarkMode } = useTheme();

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
    navigate('/login');
  };

  const adminName = localStorage.getItem('nh_admin_name') || 'Administrator';
  const selectedDistrict = districts.find(d => d.slug === selectedSlug);

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar — same coral identity as the member app */}
      <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-coral-400 to-coral-600 text-white">
            <Shield className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-display text-base font-extrabold leading-tight">NurtureHUB</h2>
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Admin Panel
            </span>
          </div>
          <button
            onClick={toggleDarkMode}
            title="Toggle theme mode"
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
                <MapPin className="size-4 shrink-0 text-primary" />
                <span className="flex-1 truncate text-left">{selectedDistrict?.name || 'Select District'}</span>
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
                  <span className="text-[11px] opacity-60">{d.user_count} users</span>
                </span>
              ),
            }))}
          />
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {navItems.map(item => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
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
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border p-3">
          <Avatar name={adminName} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{adminName}</div>
            <div className="text-xs text-ink-muted">Super Admin</div>
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
          >
            <LogOut className="size-4.5" />
          </button>
        </div>
      </aside>

      <main className="min-h-screen pl-64">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
};

export default AdminLayout;
