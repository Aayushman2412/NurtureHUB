import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import MainHeader from './MainHeader';
import NotificationPanel from './NotificationPanel';

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const location = useLocation();

  // Determine header title based on current route
  const getHeaderTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return 'Dashboard';
    if (path.startsWith('/tutorials')) return 'Training Modules';
    if (path.startsWith('/tests')) return 'Assessments & Quizzes';
    if (path.startsWith('/results')) return 'Assessment Performance';
    if (path === '/profile') return 'Profile Settings';
    return 'NurtureHUB';
  };

  return (
    <div className="app-container" style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* Sidebar Navigation */}
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
      />

      {/* Main Work Area */}
      <div className="main-content" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <MainHeader
          title={getHeaderTitle()}
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          onToggleNotifs={() => setNotifOpen(prev => !prev)}
          unreadNotifsCount={unreadCount}
        />

        <main style={{ flex: 1, padding: 'var(--space-6)', overflowY: 'auto' }}>
          {children}
        </main>
      </div>

      {/* Notification Slide Panel */}
      <NotificationPanel 
        isOpen={notifOpen} 
        onClose={() => setNotifOpen(false)}
        onUpdateCount={(count) => setUnreadCount(count)}
      />
    </div>
  );
};

export default AppLayout;
