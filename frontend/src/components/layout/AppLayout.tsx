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
    <div className="min-h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main column — offset by sidebar width on desktop */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <MainHeader
          title={getHeaderTitle()}
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          onToggleNotifs={() => setNotifOpen(prev => !prev)}
          unreadNotifsCount={unreadCount}
        />

        <main className="flex-1 animate-fade-in overflow-x-hidden p-5 sm:p-6">{children}</main>
      </div>

      <NotificationPanel
        isOpen={notifOpen}
        onClose={() => setNotifOpen(false)}
        onUpdateCount={count => setUnreadCount(count)}
      />
    </div>
  );
};

export default AppLayout;
