import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { getNotifications, markAsRead, markAllAsRead } from '../../api/notifications';

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
      } catch (err) {
        // Silent error for polling
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkAsRead = async (id: number) => {
    try {
      await markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: true } : n))
      );
      // Recalculate unread count
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
    <div id="notifPanel" className={`notif-panel ${isOpen ? 'open' : ''}`}>
      {/* Header */}
      <div className="notif-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={20} style={{ color: 'var(--primary-500)' }} />
          <span style={{ fontWeight: 600 }}>Notifications</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {notifications.some(n => !n.is_read) && (
            <button
              onClick={handleMarkAllRead}
              className="btn btn-outline"
              style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Mark all as read"
            >
              <CheckCheck size={14} />
              <span>Read All</span>
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Body List */}
      <div className="notif-body">
        {loading && notifications.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '30px' }}>
            <span className="spinner">Loading...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔔</div>
            <p>You have no notifications yet.</p>
          </div>
        ) : (
          notifications.map(n => (
            <div
              key={n.id}
              className={`notif-item ${!n.is_read ? 'unread' : ''}`}
              onClick={() => !n.is_read && handleMarkAsRead(n.id)}
              style={{ cursor: !n.is_read ? 'pointer' : 'default' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <span className="notif-item-title">{n.title}</span>
                {!n.is_read && <span className="notif-item-badge" />}
              </div>
              <p className="notif-item-message">{n.message}</p>
              <span className="notif-item-time">
                {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(n.created_at).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default NotificationPanel;
