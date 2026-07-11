import React, { useEffect, useState } from 'react';
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
      alert(err.response?.data?.detail || 'Failed to create district');
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
      alert(err.response?.data?.detail || 'Failed to update district');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (
      !confirm(
        `Delete district "${name}"? All associated stages, tutorials, and tests will be removed. Users will be unassigned.`,
      )
    )
      return;
    try {
      await client.delete(`/api/admin/districts/${id}`);
      loadDistricts();
      window.dispatchEvent(new Event('district-changed'));
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete district');
    }
  };

  if (loading) return <PageLoader label="Loading districts…" />;

  return (
    <div>
      <PageHeader
        title="District Management"
        description="Add, edit, or remove program districts. Each district has its own registration form, tutorials, and assessments."
        actions={
          <Button iconLeft={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
            Add District
          </Button>
        }
      />

      {districts.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title="No districts configured yet"
          description="Create your first program district to get started."
          action={
            <Button iconLeft={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
              Add Your First District
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
                      <Button variant="ghost" size="sm" onClick={() => handleUpdate(d.id)} disabled={saving} title="Save">
                        <Save className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} title="Cancel">
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
                    <strong className="text-ink">{d.user_count}</strong> users
                  </span>
                </span>
                <span
                  className={`flex items-center gap-1.5 font-semibold ${d.is_active ? 'text-success-600' : 'text-error-600'}`}
                >
                  <CheckCircle2 className="size-3.5" />
                  {d.is_active ? 'Active' : 'Inactive'}
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
                  Rename
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(d.id, d.name)} title="Delete">
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
        title="Add New District"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button iconLeft={<Plus className="size-4" />} onClick={handleAdd} disabled={!newName.trim() || saving}>
              {saving ? 'Creating...' : 'Create District'}
            </Button>
          </>
        }
      >
        <label className="mb-2 block text-sm font-semibold text-ink">District Name *</label>
        <Input
          placeholder="e.g. Indore, Bhopal, Assam..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          autoFocus
        />
        <p className="mt-2 text-xs text-ink-faint">
          A unique slug will be auto-generated from the name. The district will get its own registration form,
          tutorials, and tests.
        </p>
      </Modal>
    </div>
  );
};

export default AdminDistrictsPage;
