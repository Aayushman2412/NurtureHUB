import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck, X } from 'lucide-react';
import { getNotifications, markAsRead, markAllAsRead } from '../../api/notifications';
import { Button, EmptyState, Spinner } from '../ui';
import { cn } from '../../utils/cn';

interface Notification {
  id: number;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateCount: (count: number) => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({ isOpen, onClose, onUpdateCount }) => {
  const { t } = useTranslation('app');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifs = async () => {
    setLoading(true);
    try {
      const data = await getNotifications();
      setNotifications(data);
      const unread = data.filter((n: Notification) => !n.is_read).length;
      onUpdateCount(unread);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifs();
    }
  }, [isOpen]);

  // Periodically fetch notifications count
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getNotifications();
        const unread = data.filter((n: Notification) => !n.is_read).length;
        onUpdateCount(unread);
      } catch {
        // Silent error for polling
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkAsRead = async (id: number) => {
    try {
      await markAsRead(id);
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
      const updated = notifications.map(n => (n.id === id ? { ...n, is_read: true } : n));
      const unread = updated.filter(n => !n.is_read).length;
      onUpdateCount(unread);
    } catch (err) {
      console.error('Failed to read notification:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      onUpdateCount(0);
    } catch (err) {
      console.error('Failed to read all notifications:', err);
    }
  };

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-(--z-modal-backdrop) bg-cream-950/40 backdrop-blur-xs transition-opacity print:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-(--z-modal) flex w-[min(360px,90vw)] flex-col border-l border-border bg-surface shadow-2xl',
          'transition-transform duration-300 print:hidden',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-primary-ink" />
            <span className="font-display font-bold">{t('notifications.title')}</span>
          </div>
          <div className="flex items-center gap-2">
            {notifications.some(n => !n.is_read) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllRead}
                iconLeft={<CheckCheck className="size-3.5" />}
                title={t('notifications.markAllRead')}
              >
                {t('notifications.readAll')}
              </Button>
            )}
            <button
              onClick={onClose}
              aria-label={t('notifications.close')}
              className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && notifications.length === 0 ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<Bell />}
              title={t('notifications.emptyTitle')}
              description={t('notifications.emptyBody')}
              className="mt-6"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {notifications.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.is_read && handleMarkAsRead(n.id)}
                  className={cn(
                    'w-full rounded-xl border p-3.5 text-left transition-colors',
                    n.is_read
                      ? 'border-border bg-surface'
                      : 'cursor-pointer border-primary/30 bg-coral-50 hover:bg-coral-100 dark:bg-coral-500/10 dark:hover:bg-coral-500/15',
                  )}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="font-semibold text-ink">{n.title}</span>
                    {!n.is_read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{n.message}</p>
                  <span className="mt-2 block text-xs text-ink-faint">
                    {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} •{' '}
                    {new Date(n.created_at).toLocaleDateString('en-GB')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default NotificationPanel;
