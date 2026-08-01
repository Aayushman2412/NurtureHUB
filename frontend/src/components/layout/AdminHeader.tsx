import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { Avatar, Dropdown } from '../ui';

interface AdminHeaderProps {
  adminName: string;
}

const iconBtn =
  'flex size-9.5 items-center justify-center rounded-full text-ink-muted transition-colors ' +
  'hover:bg-surface-sunken hover:text-ink cursor-pointer';

/** Top-right header for the admin panel: a placeholder notification bell and
 * a profile avatar that opens /admin/profile. Sits above {children} in
 * AdminLayout's <main>. */
const AdminHeader: React.FC<AdminHeaderProps> = ({ adminName }) => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-(--z-dropdown) flex items-center justify-end gap-2 border-b border-border bg-surface/85 px-6 py-3 backdrop-blur-md">
      <Dropdown
        align="right"
        trigger={() => (
          <button type="button" className={iconBtn} title={t('layout.notifications')}>
            <Bell className="size-5" />
          </button>
        )}
        items={[
          {
            key: 'empty',
            onSelect: () => {},
            label: <span className="text-ink-muted">{t('layout.noNotifications')}</span>,
          },
        ]}
      />

      <button
        type="button"
        onClick={() => navigate('/admin/profile')}
        title={t('profile.title')}
      >
        <Avatar name={adminName} size="sm" className="ring-2 ring-primary cursor-pointer" />
      </button>
    </header>
  );
};

export default AdminHeader;
