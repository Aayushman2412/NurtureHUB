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
          <div className="sidebar-header">
            <div className="sidebar-logo">🌱</div>
            <span className="sidebar-brand">NurtureHUB</span>
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
                <span className="nav-icon">
                  <item.icon size={18} />
                </span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User Profile Footer */}
        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="avatar font-display">
                {user.avatar_initials || 'U'}
              </div>
              <div className="sidebar-user-info">
                <div className="name">{user.full_name || 'User'}</div>
                <div className="role">{user.role || 'ICDS Worker'}</div>
              </div>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={logout}
                title="Sign Out"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', padding: '6px' }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
