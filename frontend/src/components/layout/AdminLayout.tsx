import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, FileText, Video, ClipboardList, LogOut, Shield, MapPin, ChevronDown, Building2, Sun, Moon,
  MonitorPlay, GraduationCap, Radio, Activity, Table2, FileSpreadsheet, Menu,
  DatabaseZap, Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { defaultProject, groupProjects, listProjects, type ProjectGroups } from '../../api/projects';
import { getProjectSlug, onProjectChanged, setProjectSlug, type AdminProject } from '../../lib/adminProject';
import { useTheme } from '../../context/ThemeContext';
import { Avatar, Dropdown } from '../ui';
import { cn } from '../../utils/cn';

interface AdminLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { to: '/admin', icon: LayoutDashboard, key: 'dashboard', end: true },
  { to: '/admin/projects', icon: Building2, key: 'projects', end: false },
  { to: '/admin/learners', icon: Users, key: 'learners', end: false },
  { to: '/admin/form-builder', icon: FileText, key: 'formBuilder', end: false },
  { to: '/admin/tutorials', icon: Video, key: 'tutorials', end: false },
  { to: '/admin/tutorial-tracking', icon: MonitorPlay, key: 'tutorialTracking', end: false },
  { to: '/admin/tests', icon: ClipboardList, key: 'testManager', end: false },
  { to: '/admin/tests', icon: Radio, key: 'liveMonitor', end: false },
  { to: '/admin/results', icon: GraduationCap, key: 'results', end: false },
  { to: '/admin/growth', icon: Activity, key: 'growthMonitor', end: false },
] as const;

// "Database" section — the data-analytics pipelines (admin-run crosstabs/MASD)
// and the raw-data generator that feeds them from the app's own form data.
const databaseNavItems = [
  { to: '/admin/database/rawdata', icon: DatabaseZap, key: 'rawData', end: false },
  { to: '/admin/database/crosstabs', icon: Table2, key: 'crosstabsPipeline', end: false },
  { to: '/admin/database/masd', icon: FileSpreadsheet, key: 'masdPipeline', end: false },
] as const;

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('admin');
  const { darkMode, toggleDarkMode } = useTheme();
  const { logout } = useAuth();

  // Below lg the sidebar is a slide-in drawer (same pattern as the learner
  // Sidebar); on desktop it is pinned open and this state is ignored.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [groups, setGroups] = useState<ProjectGroups>({ states: [], standalone: [], flat: [] });
  const [selectedSlug, setSelectedSlug] = useState<string>(getProjectSlug() || '');

  const loadProjects = useCallback(() => {
    listProjects()
      .then(list => {
        const next = groupProjects(list);
        setGroups(next);
        // Land on a sane project: never auto-select a STATE (that would edit
        // state-wide content unknowingly), and never keep a slug whose project
        // was renamed or deleted — that silently empties every content page.
        const stored = getProjectSlug();
        const stillExists = stored && next.flat.some(p => p.slug === stored);
        if (!stillExists) {
          const fallback = defaultProject(next);
          if (fallback) {
            setSelectedSlug(fallback.slug);
            setProjectSlug(fallback.slug);
          }
        } else if (stored !== selectedSlug) {
          setSelectedSlug(stored);
        }
      })
      .catch(() => {});
    // selectedSlug intentionally omitted: this must not refetch on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    return onProjectChanged(() => {
      setSelectedSlug(getProjectSlug() || '');
      loadProjects();
    });
  }, [loadProjects]);

  const handleSwitchDistrict = (slug: string) => {
    setSelectedSlug(slug);
    setProjectSlug(slug);
  };

  const handleLogout = () => {
    // End the WHOLE session, not just the admin half. This used to remove only
    // the nh_admin* keys, which left nh_token in localStorage and the
    // AuthContext user object populated — so isAuthenticated stayed true after
    // "Log out": the landing page kept offering "Continue your journey",
    // PublicRoute bounced /login away so there was no way back to the login
    // form, and one click dropped you into the learner app still signed in as
    // the account you had just logged out of.
    logout();
    navigate('/login');
  };

  const adminName = localStorage.getItem('nh_admin_name') || t('layout.adminFallback');
  const selectedProject = groups.flat.find(p => p.slug === selectedSlug);
  const parentState = selectedProject?.parent_id
    ? groups.flat.find(p => p.id === selectedProject.parent_id)
    : undefined;

  /** Menu rows: each state, then its districts indented under it, then the
   *  standalone districts. A state row is itself selectable — it is a real
   *  project with its own content. */
  const projectRow = (project: AdminProject, nested: boolean) => ({
    key: project.slug,
    selected: project.slug === selectedSlug,
    onSelect: () => handleSwitchDistrict(project.slug),
    label: (
      <span className={cn('flex w-full items-center justify-between gap-2', nested && 'pl-5')}>
        <span className="flex min-w-0 items-center gap-2">
          {project.level === 'state'
            ? <Building2 className="size-3.5 shrink-0" />
            : <MapPin className="size-3.5 shrink-0" />}
          <span className={cn('truncate', project.level === 'state' && 'font-semibold')}>
            {project.name}
          </span>
          {project.level === 'state' && (
            <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
              {t('layout.stateBadge')}
            </span>
          )}
          {project.inherits_content && (
            <span className="shrink-0 text-[10px] text-ink-faint">{t('layout.inheritsBadge')}</span>
          )}
        </span>
        <span className="shrink-0 text-[11px] opacity-60">
          {t('layout.usersCount', { n: project.user_count ?? 0 })}
        </span>
      </span>
    ),
  });

  const projectMenuItems = [
    ...groups.states.flatMap(({ state, children }) => [
      projectRow(state, false),
      ...children.map(child => projectRow(child, true)),
    ]),
    ...groups.standalone.map(project => projectRow(project, false)),
  ];

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

        {/* Project switcher — states carry their district projects nested. */}
        <div className="px-3 pt-3">
          <Dropdown
            className="w-full"
            trigger={open => (
              <button
                className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface-sunken px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong cursor-pointer"
              >
                {selectedProject?.level === 'state'
                  ? <Building2 className="size-4 shrink-0 text-primary-ink" />
                  : <MapPin className="size-4 shrink-0 text-primary-ink" />}
                <span className="min-w-0 flex-1 text-left">
                  {parentState && (
                    <span className="block truncate text-[11px] font-medium text-ink-faint">
                      {parentState.name}
                    </span>
                  )}
                  <span className="block truncate">
                    {selectedProject?.name || t('layout.selectProject')}
                  </span>
                </span>
                <ChevronDown className={cn('size-3.5 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
              </button>
            )}
            items={projectMenuItems}
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
