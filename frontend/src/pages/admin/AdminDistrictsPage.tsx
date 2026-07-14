import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import { Plus, Trash2, Edit3, Save, X, MapPin, Users, CheckCircle2 } from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal, PageHeader, PageLoader } from '../../components/ui';

interface ProgramDistrict {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  user_count: number;
}

const AdminDistrictsPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const [districts, setDistricts] = useState<ProgramDistrict[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadDistricts = () => {
    client
      .get('/api/admin/districts')
      .then(res => {
        setDistricts(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadDistricts();
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await client.post('/api/admin/districts', { name: newName.trim() });
      setNewName('');
      setShowAddModal(false);
      loadDistricts();
      window.dispatchEvent(new Event('district-changed'));
    } catch (err: any) {
      alert(err.response?.data?.detail || t('districts.errCreate'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await client.put(`/api/admin/districts/${id}`, { name: editName.trim() });
      setEditingId(null);
      loadDistricts();
      window.dispatchEvent(new Event('district-changed'));
    } catch (err: any) {
      alert(err.response?.data?.detail || t('districts.errUpdate'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('districts.confirmDelete', { name }))) return;
    try {
      await client.delete(`/api/admin/districts/${id}`);
      loadDistricts();
      window.dispatchEvent(new Event('district-changed'));
    } catch (err: any) {
      alert(err.response?.data?.detail || t('districts.errDelete'));
    }
  };

  if (loading) return <PageLoader label={t('districts.loading')} />;

  return (
    <div>
      <PageHeader
        title={t('districts.title')}
        description={t('districts.description')}
        actions={
          <Button iconLeft={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
            {t('districts.add')}
          </Button>
        }
      />

      {districts.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title={t('districts.emptyTitle')}
          description={t('districts.emptyBody')}
          action={
            <Button iconLeft={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
              {t('districts.addFirst')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {districts.map(d => (
            <Card key={d.id} className="flex flex-col gap-4 p-6">
              <div className="flex items-center gap-3.5">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300">
                  <MapPin className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  {editingId === d.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleUpdate(d.id)}
                        autoFocus
                        className="py-1.5"
                      />
                      <Button variant="ghost" size="sm" onClick={() => handleUpdate(d.id)} disabled={saving} title={t('districts.save')}>
                        <Save className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} title={t('districts.cancel')}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <h3 className="font-display text-lg font-bold text-ink">{d.name}</h3>
                      <span className="font-mono text-xs text-ink-faint">/{d.slug}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-[13px]">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Users className="size-3.5" />
                  <span>
                    <strong className="text-ink">{d.user_count}</strong> {t('districts.users')}
                  </span>
                </span>
                <span
                  className={`flex items-center gap-1.5 font-semibold ${d.is_active ? 'text-success-600' : 'text-error-600'}`}
                >
                  <CheckCircle2 className="size-3.5" />
                  {d.is_active ? t('districts.active') : t('districts.inactive')}
                </span>
              </div>

              <div className="flex gap-2 border-t border-border pt-3.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  iconLeft={<Edit3 className="size-3.5" />}
                  onClick={() => {
                    setEditingId(d.id);
                    setEditName(d.name);
                  }}
                >
                  {t('districts.rename')}
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(d.id, d.name)} title={t('districts.delete')}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t('districts.addModalTitle')}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              {t('districts.cancel')}
            </Button>
            <Button iconLeft={<Plus className="size-4" />} onClick={handleAdd} disabled={!newName.trim() || saving}>
              {saving ? t('districts.creating') : t('districts.create')}
            </Button>
          </>
        }
      >
        <label className="mb-2 block text-sm font-semibold text-ink">{t('districts.nameLabel')}</label>
        <Input
          placeholder={t('districts.namePlaceholder')}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          autoFocus
        />
        <p className="mt-2 text-xs text-ink-faint">
          {t('districts.nameHelp')}
        </p>
      </Modal>
    </div>
  );
};

export default AdminDistrictsPage;
