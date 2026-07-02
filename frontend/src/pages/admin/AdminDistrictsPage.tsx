import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import { Plus, Trash2, Edit3, Save, X, MapPin, Users, CheckCircle2 } from 'lucide-react';

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
    client.get('/api/admin/districts')
      .then(res => { setDistricts(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadDistricts(); }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await client.post('/api/admin/districts', { name: newName.trim() });
      setNewName('');
      setShowAddModal(false);
      loadDistricts();
      // Notify layout to refresh district list
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
    if (!confirm(`Delete district "${name}"? All associated stages, tutorials, and tests will be removed. Users will be unassigned.`)) return;
    try {
      await client.delete(`/api/admin/districts/${id}`);
      loadDistricts();
      window.dispatchEvent(new Event('district-changed'));
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete district');
    }
  };

  if (loading) return <div className="admin-page"><div className="admin-loading">Loading districts...</div></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">District Management</h1>
          <p className="admin-page-desc">Add, edit, or remove program districts. Each district has its own registration form, tutorials, and assessments.</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={16} /> Add District
        </button>
      </div>

      {/* District Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginTop: '8px' }}>
        {districts.map(d => (
          <div
            key={d.id}
            style={{
              background: 'var(--admin-card-bg, #1e293b)',
              border: '1px solid var(--admin-border, rgba(148,163,184,0.1))',
              borderRadius: '14px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              transition: 'all 0.2s',
              position: 'relative',
            }}
          >
            {/* District icon + name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.15))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#a78bfa', flexShrink: 0,
              }}>
                <MapPin size={24} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingId === d.id ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      className="admin-input"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUpdate(d.id)}
                      autoFocus
                      style={{ fontSize: '1rem', padding: '6px 10px' }}
                    />
                    <button className="admin-icon-btn" onClick={() => handleUpdate(d.id)} disabled={saving} title="Save">
                      <Save size={16} />
                    </button>
                    <button className="admin-icon-btn" onClick={() => setEditingId(null)} title="Cancel">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--admin-text, #e2e8f0)', margin: 0 }}>
                      {d.name}
                    </h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted, #64748b)', fontFamily: 'monospace' }}>
                      /{d.slug}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--admin-text-muted, #94a3b8)', fontSize: '0.8125rem' }}>
                <Users size={14} />
                <span><strong style={{ color: 'var(--admin-text, #e2e8f0)' }}>{d.user_count}</strong> users</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem' }}>
                <CheckCircle2 size={14} style={{ color: d.is_active ? '#22c55e' : '#ef4444' }} />
                <span style={{ color: d.is_active ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                  {d.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--admin-border, rgba(148,163,184,0.1))', paddingTop: '14px' }}>
              <button
                className="admin-btn admin-btn-outline"
                style={{ flex: 1, fontSize: '0.8125rem', padding: '8px 12px' }}
                onClick={() => { setEditingId(d.id); setEditName(d.name); }}
              >
                <Edit3 size={14} /> Rename
              </button>
              <button
                className="admin-btn admin-btn-outline"
                style={{ fontSize: '0.8125rem', padding: '8px 12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                onClick={() => handleDelete(d.id, d.name)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {/* Empty add card */}
        {districts.length === 0 && (
          <div style={{
            background: 'var(--admin-card-bg, #1e293b)',
            border: '2px dashed var(--admin-border, rgba(148,163,184,0.2))',
            borderRadius: '14px',
            padding: '48px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            color: 'var(--admin-text-muted, #64748b)',
          }}>
            <MapPin size={32} />
            <p style={{ margin: 0, fontSize: '0.9375rem' }}>No districts configured yet</p>
            <button className="admin-btn admin-btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={16} /> Add Your First District
            </button>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="admin-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="admin-modal-header">
              <h3>Add New District</h3>
              <button onClick={() => setShowAddModal(false)} className="admin-icon-btn"><X size={20} /></button>
            </div>
            <div className="admin-modal-body">
              <div>
                <label className="admin-label">District Name *</label>
                <input
                  className="admin-input"
                  placeholder="e.g. Indore, Bhopal, Assam..."
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  autoFocus
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted, #64748b)', marginTop: '8px' }}>
                  A unique slug will be auto-generated from the name. The district will get its own registration form, tutorials, and tests.
                </p>
              </div>
            </div>
            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-outline" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleAdd} disabled={!newName.trim() || saving}>
                <Plus size={16} /> {saving ? 'Creating...' : 'Create District'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDistrictsPage;
