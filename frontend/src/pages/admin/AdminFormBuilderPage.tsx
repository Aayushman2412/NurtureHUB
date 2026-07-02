import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown, Edit3, Save, X, Eye } from 'lucide-react';

interface FieldOption {
  label: string;
  value: string;
}

interface FormField {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  required: boolean;
  options: FieldOption[] | null;
}

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input' },
  { value: 'number', label: 'Number Input' },
  { value: 'date', label: 'Date Picker' },
  { value: 'dropdown', label: 'Dropdown Select' },
  { value: 'radio', label: 'Radio Group' },
  { value: 'textarea', label: 'Text Area' },
];

const AdminFormBuilderPage: React.FC = () => {
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [newField, setNewField] = useState<FormField>({
    id: '', label: '', type: 'text', placeholder: '', required: true, options: null
  });
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [editOptionLabel, setEditOptionLabel] = useState('');

  const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

  const loadFields = () => {
    setLoading(true);
    client.get(`/api/admin/form-config?district=${getDistrict()}`)
      .then(res => { setFields(res.data.fields); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadFields();
    const handleDistrictChange = () => loadFields();
    window.addEventListener('district-changed', handleDistrictChange);
    return () => window.removeEventListener('district-changed', handleDistrictChange);
  }, []);

  const saveConfig = (updatedFields: FormField[]) => {
    setFields(updatedFields);
    client.put(`/api/admin/form-config?district=${getDistrict()}`, { fields: updatedFields }).catch(() => {});
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    const newFields = [...fields];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newFields.length) return;
    [newFields[index], newFields[targetIdx]] = [newFields[targetIdx], newFields[index]];
    saveConfig(newFields);
  };

  const removeField = (id: string) => {
    if (!confirm('Remove this field from the registration form?')) return;
    saveConfig(fields.filter(f => f.id !== id));
  };

  const addField = () => {
    if (!newField.label.trim()) return;
    const id = newField.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();
    const field: FormField = { ...newField, id };
    if (['dropdown', 'radio'].includes(field.type) && !field.options) {
      field.options = [];
    }
    saveConfig([...fields, field]);
    setNewField({ id: '', label: '', type: 'text', placeholder: '', required: true, options: null });
    setShowAddModal(false);
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    const newFields = fields.map(f => f.id === id ? { ...f, ...updates } : f);
    saveConfig(newFields);
  };

  const addOptionToField = (fieldId: string) => {
    if (!editOptionLabel.trim()) return;
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;
    const newOpt: FieldOption = { label: editOptionLabel.trim(), value: editOptionLabel.trim().toLowerCase().replace(/\s+/g, '_') };
    updateField(fieldId, { options: [...(field.options || []), newOpt] });
    setEditOptionLabel('');
  };

  const removeOptionFromField = (fieldId: string, optIndex: number) => {
    const field = fields.find(f => f.id === fieldId);
    if (!field || !field.options) return;
    const newOpts = field.options.filter((_, i) => i !== optIndex);
    updateField(fieldId, { options: newOpts });
  };

  const addOptionToNewField = () => {
    if (!newOptionLabel.trim()) return;
    const newOpt: FieldOption = { label: newOptionLabel.trim(), value: newOptionLabel.trim().toLowerCase().replace(/\s+/g, '_') };
    setNewField({ ...newField, options: [...(newField.options || []), newOpt] });
    setNewOptionLabel('');
  };

  const getTypeIcon = (type: string) => {
    const map: Record<string, string> = { text: '📝', number: '🔢', date: '📅', dropdown: '📋', radio: '🔘', textarea: '📄' };
    return map[type] || '📝';
  };

  if (loading) return <div className="admin-page"><div className="admin-loading">Loading form configuration...</div></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Registration Form Builder</h1>
          <p className="admin-page-desc">Add, remove, and reorder fields in the user registration form. Changes are saved automatically.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="admin-btn admin-btn-outline" onClick={() => setShowPreview(!showPreview)}>
            <Eye size={16} /> {showPreview ? 'Hide Preview' : 'Preview Form'}
          </button>
          <button className="admin-btn admin-btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> Add Field
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showPreview ? '1fr 1fr' : '1fr', gap: '24px' }}>
        {/* Fields List */}
        <div className="admin-card-list">
          {fields.map((field, idx) => (
            <div key={field.id} className="admin-form-field-card">
              <div className="admin-field-header">
                <div className="admin-field-grip">
                  <GripVertical size={16} />
                </div>
                <span className="admin-field-type-icon">{getTypeIcon(field.type)}</span>
                <div className="admin-field-info">
                  <span className="admin-field-label">{field.label}</span>
                  <span className="admin-field-meta">
                    {FIELD_TYPES.find(t => t.value === field.type)?.label} • {field.required ? 'Required' : 'Optional'}
                    {field.options ? ` • ${field.options.length} options` : ''}
                  </span>
                </div>
                <div className="admin-field-actions">
                  <button onClick={() => moveField(idx, 'up')} disabled={idx === 0} className="admin-icon-btn" title="Move up"><ChevronUp size={16} /></button>
                  <button onClick={() => moveField(idx, 'down')} disabled={idx === fields.length - 1} className="admin-icon-btn" title="Move down"><ChevronDown size={16} /></button>
                  <button onClick={() => setEditingField(editingField === field.id ? null : field.id)} className="admin-icon-btn" title="Edit"><Edit3 size={16} /></button>
                  <button onClick={() => removeField(field.id)} className="admin-icon-btn danger" title="Remove"><Trash2 size={16} /></button>
                </div>
              </div>

              {/* Expanded edit panel */}
              {editingField === field.id && (
                <div className="admin-field-edit-panel">
                  <div className="admin-field-edit-grid">
                    <div>
                      <label className="admin-label">Label</label>
                      <input className="admin-input" value={field.label} onChange={e => updateField(field.id, { label: e.target.value })} />
                    </div>
                    <div>
                      <label className="admin-label">Type</label>
                      <select className="admin-input" value={field.type} onChange={e => updateField(field.id, { type: e.target.value, options: ['dropdown', 'radio'].includes(e.target.value) ? (field.options || []) : null })}>
                        {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="admin-label">Placeholder</label>
                      <input className="admin-input" value={field.placeholder} onChange={e => updateField(field.id, { placeholder: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '24px' }}>
                      <input type="checkbox" checked={field.required} onChange={e => updateField(field.id, { required: e.target.checked })} style={{ accentColor: '#6366f1' }} />
                      <label className="admin-label" style={{ margin: 0 }}>Required</label>
                    </div>
                  </div>

                  {/* Options editor for dropdown/radio */}
                  {field.options !== null && (
                    <div className="admin-options-editor">
                      <label className="admin-label">Options</label>
                      <div className="admin-options-list">
                        {field.options.map((opt, oi) => (
                          <div key={oi} className="admin-option-item">
                            <span>{opt.label}</span>
                            <button onClick={() => removeOptionFromField(field.id, oi)} className="admin-icon-btn danger sm"><Trash2 size={12} /></button>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <input className="admin-input sm" placeholder="New option label" value={editOptionLabel} onChange={e => setEditOptionLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOptionToField(field.id)} />
                        <button className="admin-btn admin-btn-sm admin-btn-primary" onClick={() => addOptionToField(field.id)}>Add</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Preview Panel */}
        {showPreview && (
          <div className="admin-preview-panel">
            <h3 className="admin-preview-title">Form Preview</h3>
            <div className="admin-preview-form">
              {fields.map(field => (
                <div key={field.id} className="admin-preview-field">
                  <label className="admin-preview-label">
                    {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                  </label>
                  {field.type === 'text' && <input className="admin-preview-input" placeholder={field.placeholder} readOnly />}
                  {field.type === 'number' && <input className="admin-preview-input" type="number" placeholder={field.placeholder} readOnly />}
                  {field.type === 'date' && <input className="admin-preview-input" type="date" readOnly />}
                  {field.type === 'textarea' && <textarea className="admin-preview-input" placeholder={field.placeholder} rows={3} readOnly />}
                  {field.type === 'dropdown' && (
                    <select className="admin-preview-input">
                      <option>{field.placeholder || 'Select...'}</option>
                      {field.options?.map((o, i) => <option key={i}>{o.label}</option>)}
                    </select>
                  )}
                  {field.type === 'radio' && (
                    <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                      {field.options?.map((o, i) => (
                        <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          <input type="radio" name={field.id} readOnly /> {o.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Field Modal */}
      {showAddModal && (
        <div className="admin-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Add New Form Field</h3>
              <button onClick={() => setShowAddModal(false)} className="admin-icon-btn"><X size={20} /></button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-field-edit-grid">
                <div>
                  <label className="admin-label">Field Label *</label>
                  <input className="admin-input" placeholder="e.g. Aadhar Number" value={newField.label} onChange={e => setNewField({ ...newField, label: e.target.value })} />
                </div>
                <div>
                  <label className="admin-label">Type</label>
                  <select className="admin-input" value={newField.type} onChange={e => setNewField({ ...newField, type: e.target.value, options: ['dropdown', 'radio'].includes(e.target.value) ? [] : null })}>
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="admin-label">Placeholder</label>
                  <input className="admin-input" placeholder="e.g. Enter your ID..." value={newField.placeholder} onChange={e => setNewField({ ...newField, placeholder: e.target.value })} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '24px' }}>
                  <input type="checkbox" checked={newField.required} onChange={e => setNewField({ ...newField, required: e.target.checked })} style={{ accentColor: '#6366f1' }} />
                  <label className="admin-label" style={{ margin: 0 }}>Required</label>
                </div>
              </div>

              {newField.options !== null && (
                <div className="admin-options-editor" style={{ marginTop: '16px' }}>
                  <label className="admin-label">Options</label>
                  <div className="admin-options-list">
                    {newField.options.map((opt, oi) => (
                      <div key={oi} className="admin-option-item">
                        <span>{opt.label}</span>
                        <button onClick={() => setNewField({ ...newField, options: newField.options!.filter((_, i) => i !== oi) })} className="admin-icon-btn danger sm"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <input className="admin-input sm" placeholder="Option label" value={newOptionLabel} onChange={e => setNewOptionLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOptionToNewField()} />
                    <button className="admin-btn admin-btn-sm admin-btn-primary" onClick={addOptionToNewField}>Add</button>
                  </div>
                </div>
              )}
            </div>
            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-outline" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={addField} disabled={!newField.label.trim()}>
                <Save size={16} /> Add Field
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminFormBuilderPage;
