import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LayoutDashboard, Video, Award, User, LogOut } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/tutorials', label: 'Tutorials', icon: Video },
    { to: '/tests', label: 'Assessments', icon: Award },
    { to: '/profile', label: 'Profile', icon: User },
  ];

  return (
    <>
      {/* Sidebar Overlay (Mobile) */}
      <div 
        className={`sidebar-overlay ${isOpen ? 'active' : ''}`} 
        onClick={onClose}
      />

      {/* Sidebar Container */}
      <aside id="sidebar" className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div>
          {/* Brand/Logo Header */}
          <div className="sidebar-brand">
            <span style={{ fontSize: '1.5rem' }}>🌱</span>
            <div>
              <span className="brand-name">NurtureHUB</span>
              <span className="brand-subtitle font-display">ICDS Training Portal</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <item.icon size={20} className="nav-item-icon" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User Profile Footer */}
        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="avatar avatar-md font-display">
                {user.avatar_initials || 'U'}
              </div>
              <div className="user-info">
                <span className="user-name">{user.full_name || 'User'}</span>
                <span className="user-role">{user.role || 'ICDS Worker'}</span>
              </div>
            </div>
            <button 
              className="btn btn-outline" 
              onClick={logout}
              style={{ 
                width: '100%', 
                marginTop: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '8px',
                borderColor: 'var(--gray-200)',
                color: 'var(--text-secondary)'
              }}
            >
              <LogOut size={16} />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
