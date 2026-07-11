import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown, Edit3, Save, Eye } from 'lucide-react';
import { Button, Card, Checkbox, Input, Modal, PageHeader, PageLoader, Select } from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import { cn } from '../../utils/cn';

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

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="mb-1.5 block text-xs font-semibold text-ink-muted">{children}</label>
);

const AdminFormBuilderPage: React.FC = () => {
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [newField, setNewField] = useState<FormField>({
    id: '',
    label: '',
    type: 'text',
    placeholder: '',
    required: true,
    options: null,
  });
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [editOptionLabel, setEditOptionLabel] = useState('');

  const getDistrict = () => localStorage.getItem('nh_admin_district') || 'jalna';

  const loadFields = () => {
    setLoading(true);
    client
      .get(`/api/admin/form-config?district=${getDistrict()}`)
      .then(res => {
        setFields(res.data.fields);
        setLoading(false);
      })
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
    const newFields = fields.map(f => (f.id === id ? { ...f, ...updates } : f));
    saveConfig(newFields);
  };

  const addOptionToField = (fieldId: string) => {
    if (!editOptionLabel.trim()) return;
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;
    const newOpt: FieldOption = {
      label: editOptionLabel.trim(),
      value: editOptionLabel.trim().toLowerCase().replace(/\s+/g, '_'),
    };
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
    const newOpt: FieldOption = {
      label: newOptionLabel.trim(),
      value: newOptionLabel.trim().toLowerCase().replace(/\s+/g, '_'),
    };
    setNewField({ ...newField, options: [...(newField.options || []), newOpt] });
    setNewOptionLabel('');
  };

  const getTypeIcon = (type: string) => {
    const map: Record<string, string> = {
      text: '📝',
      number: '🔢',
      date: '📅',
      dropdown: '📋',
      radio: '🔘',
      textarea: '📄',
    };
    return map[type] || '📝';
  };

  if (loading) return <PageLoader label="Loading form configuration…" />;

  const iconBtn =
    'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:opacity-40 disabled:pointer-events-none';
  const dangerIconBtn =
    'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10';

  const OptionsEditor: React.FC<{
    options: FieldOption[];
    onRemove: (i: number) => void;
    optionLabel: string;
    setOptionLabel: (v: string) => void;
    onAdd: () => void;
  }> = ({ options, onRemove, optionLabel, setOptionLabel, onAdd }) => (
    <div className="mt-4">
      <Label>Options</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt, oi) => (
          <span
            key={oi}
            className="inline-flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-1.5 text-sm text-ink"
          >
            {opt.label}
            <button onClick={() => onRemove(oi)} className="text-ink-faint hover:text-error-500 cursor-pointer">
              <Trash2 className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          placeholder="New option label"
          value={optionLabel}
          onChange={e => setOptionLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()}
        />
        <Button size="sm" onClick={onAdd}>
          Add
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Registration Form Builder"
        description="Add, remove, and reorder fields in the user registration form. Changes are saved automatically."
        actions={
          <>
            <Button variant="outline" iconLeft={<Eye className="size-4" />} onClick={() => setShowPreview(!showPreview)}>
              {showPreview ? 'Hide Preview' : 'Preview Form'}
            </Button>
            <Button iconLeft={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
              Add Field
            </Button>
          </>
        }
      />

      <div className={cn('grid gap-6', showPreview ? 'lg:grid-cols-2' : 'grid-cols-1')}>
        {/* Fields */}
        <div className="flex flex-col gap-3">
          {fields.map((field, idx) => (
            <Card key={field.id} className="p-4">
              <div className="flex items-center gap-3">
                <GripVertical className="size-4 shrink-0 text-ink-faint" />
                <span className="text-xl">{getTypeIcon(field.type)}</span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{field.label}</span>
                  <span className="text-xs text-ink-faint">
                    {FIELD_TYPES.find(t => t.value === field.type)?.label} •{' '}
                    {field.required ? 'Required' : 'Optional'}
                    {field.options ? ` • ${field.options.length} options` : ''}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => moveField(idx, 'up')} disabled={idx === 0} className={iconBtn} title="Move up">
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    onClick={() => moveField(idx, 'down')}
                    disabled={idx === fields.length - 1}
                    className={iconBtn}
                    title="Move down"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    onClick={() => setEditingField(editingField === field.id ? null : field.id)}
                    className={iconBtn}
                    title="Edit"
                  >
                    <Edit3 className="size-4" />
                  </button>
                  <button onClick={() => removeField(field.id)} className={dangerIconBtn} title="Remove">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              {editingField === field.id && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Label</Label>
                      <Input value={field.label} onChange={e => updateField(field.id, { label: e.target.value })} />
                    </div>
                    <div>
                      <Label>Type</Label>
                      <Select
                        value={field.type}
                        onChange={e =>
                          updateField(field.id, {
                            type: e.target.value,
                            options: ['dropdown', 'radio'].includes(e.target.value) ? field.options || [] : null,
                          })
                        }
                      >
                        {FIELD_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Placeholder</Label>
                      <Input
                        value={field.placeholder}
                        onChange={e => updateField(field.id, { placeholder: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center pt-6">
                      <Checkbox
                        label="Required"
                        checked={field.required}
                        onChange={e => updateField(field.id, { required: e.target.checked })}
                      />
                    </div>
                  </div>

                  {field.options !== null && (
                    <OptionsEditor
                      options={field.options}
                      onRemove={oi => removeOptionFromField(field.id, oi)}
                      optionLabel={editOptionLabel}
                      setOptionLabel={setEditOptionLabel}
                      onAdd={() => addOptionToField(field.id)}
                    />
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>

        {/* Preview */}
        {showPreview && (
          <Card className="p-6">
            <h3 className="mb-4 font-display font-bold text-ink">Form Preview</h3>
            <div className="flex flex-col gap-4">
              {fields.map(field => (
                <div key={field.id}>
                  <label className="mb-1.5 block text-sm font-semibold text-ink">
                    {field.label} {field.required && <span className="text-error-500">*</span>}
                  </label>
                  {field.type === 'text' && <Input placeholder={field.placeholder} readOnly />}
                  {field.type === 'number' && <Input type="number" placeholder={field.placeholder} readOnly />}
                  {field.type === 'date' && <Input type="date" readOnly />}
                  {field.type === 'textarea' && (
                    <textarea className={cn(inputClasses(), 'resize-y')} placeholder={field.placeholder} rows={3} readOnly />
                  )}
                  {field.type === 'dropdown' && (
                    <Select>
                      <option>{field.placeholder || 'Select...'}</option>
                      {field.options?.map((o, i) => (
                        <option key={i}>{o.label}</option>
                      ))}
                    </Select>
                  )}
                  {field.type === 'radio' && (
                    <div className="mt-1 flex flex-wrap gap-4">
                      {field.options?.map((o, i) => (
                        <label key={i} className="flex items-center gap-1.5 text-sm text-ink-muted">
                          <input type="radio" name={field.id} readOnly className="accent-(--primary)" /> {o.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Add field modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Form Field"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button iconLeft={<Save className="size-4" />} onClick={addField} disabled={!newField.label.trim()}>
              Add Field
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Field Label *</Label>
            <Input
              placeholder="e.g. Aadhar Number"
              value={newField.label}
              onChange={e => setNewField({ ...newField, label: e.target.value })}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select
              value={newField.type}
              onChange={e =>
                setNewField({
                  ...newField,
                  type: e.target.value,
                  options: ['dropdown', 'radio'].includes(e.target.value) ? [] : null,
                })
              }
            >
              {FIELD_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Placeholder</Label>
            <Input
              placeholder="e.g. Enter your ID..."
              value={newField.placeholder}
              onChange={e => setNewField({ ...newField, placeholder: e.target.value })}
            />
          </div>
          <div className="flex items-center pt-6">
            <Checkbox
              label="Required"
              checked={newField.required}
              onChange={e => setNewField({ ...newField, required: e.target.checked })}
            />
          </div>
        </div>

        {newField.options !== null && (
          <OptionsEditor
            options={newField.options}
            onRemove={oi => setNewField({ ...newField, options: newField.options!.filter((_, i) => i !== oi) })}
            optionLabel={newOptionLabel}
            setOptionLabel={setNewOptionLabel}
            onAdd={addOptionToNewField}
          />
        )}
      </Modal>
    </div>
  );
};

export default AdminFormBuilderPage;
