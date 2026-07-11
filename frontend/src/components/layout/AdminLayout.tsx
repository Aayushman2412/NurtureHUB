import React, { useEffect, useState, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Video, ClipboardList, LogOut, Shield, MapPin, ChevronDown, Building2, Sun, Moon } from 'lucide-react';
import client from '../../api/client';
import { useTheme } from '../../context/ThemeContext';

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
  { to: '/admin/tests', icon: ClipboardList, label: 'Test Manager', end: false },
];

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const { darkMode, toggleDarkMode } = useTheme();
  
  const [districts, setDistricts] = useState<ProgramDistrict[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>(localStorage.getItem('nh_admin_district') || '');
  const [showSwitcher, setShowSwitcher] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const loadDistricts = () => {
    client.get('/api/admin/districts')
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

    // Listen to document clicks for click-outside close
    const handleClickOutside = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setShowSwitcher(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    // Keep switcher updated on district changes
    const handleDistrictChange = () => {
      const current = localStorage.getItem('nh_admin_district') || '';
      setSelectedSlug(current);
      loadDistricts();
    };
    window.addEventListener('district-changed', handleDistrictChange);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('district-changed', handleDistrictChange);
    };
  }, [selectedSlug]);

  const handleSwitchDistrict = (slug: string) => {
    setSelectedSlug(slug);
    localStorage.setItem('nh_admin_district', slug);
    setShowSwitcher(false);
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
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-logo-icon">
            <Shield size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 className="admin-brand">NurtureHUB</h2>
            <span className="admin-brand-sub">Admin Panel</span>
          </div>
          {/* Theme Toggle in Admin Panel Sidebar Header */}
          <button
            onClick={toggleDarkMode}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: darkMode ? '#fcd34d' : '#94a3b8',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            title="Toggle theme mode"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* District Switcher Container with Ref */}
        <div ref={switcherRef} className="admin-district-switcher" style={{ position: 'relative' }}>
          <button
            onClick={() => setShowSwitcher(!showSwitcher)}
            className="admin-district-btn"
            style={{
              width: 'calc(100% - 24px)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: darkMode ? '1px solid rgba(139, 92, 246, 0.25)' : '1px solid var(--border-color)',
              background: darkMode 
                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.08))'
                : 'var(--bg-primary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '0.8125rem',
              fontWeight: 600,
              transition: 'all 0.2s',
              margin: '12px 12px 8px 12px',
              boxSizing: 'border-box',
            }}
          >
            <MapPin size={16} style={{ color: '#a78bfa', flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedDistrict?.name || 'Select District'}
            </span>
            <ChevronDown size={14} style={{ opacity: 0.6, flexShrink: 0, transform: showSwitcher ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {showSwitcher && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: '12px',
                right: '12px',
                backgroundColor: darkMode ? '#1e1b4b' : 'var(--bg-secondary)',
                border: darkMode ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '6px',
                zIndex: 100,
                boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              {districts.map(d => (
                <button
                  key={d.slug}
                  onClick={() => handleSwitchDistrict(d.slug)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: d.slug === selectedSlug 
                      ? 'rgba(139, 92, 246, 0.15)' 
                      : 'transparent',
                    color: d.slug === selectedSlug 
                      ? '#a78bfa' 
                      : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                    fontWeight: d.slug === selectedSlug ? 700 : 500,
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (d.slug !== selectedSlug) (e.target as HTMLElement).style.background = 'rgba(99,102,241,0.05)'; }}
                  onMouseLeave={e => { if (d.slug !== selectedSlug) (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MapPin size={13} />
                    {d.name}
                  </span>
                  <span style={{ fontSize: '0.6875rem', opacity: 0.6 }}>{d.user_count} users</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="admin-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user-info">
            <div className="admin-avatar">{adminName.charAt(0).toUpperCase()}</div>
            <div>
              <div className="admin-user-name">{adminName}</div>
              <div className="admin-user-role">Super Admin</div>
            </div>
          </div>
          <button onClick={handleLogout} className="admin-logout-btn" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <main className="admin-main">
        {children}
      </main>
    </div>
  );
};

export default AdminLayout;
