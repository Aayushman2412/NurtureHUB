import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import MainHeader from './MainHeader';
import NotificationPanel from './NotificationPanel';
import PushPromptBanner from './PushPromptBanner';

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { t } = useTranslation('app');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();

  // ?notifications=1 — set by the /notifications push deep-link — opens the
  // panel, then drops the marker from the URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('notifications') === '1') {
      setNotifOpen(true);
      params.delete('notifications');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const getHeaderTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return t('headerTitle.dashboard');
    if (path.startsWith('/tutorials')) return t('headerTitle.tutorials');
    if (path.startsWith('/tests')) return t('headerTitle.tests');
    if (path.startsWith('/results')) return t('headerTitle.results');
    if (path === '/profile') return t('headerTitle.profile');
    return t('headerTitle.default');
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

        <PushPromptBanner />

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
