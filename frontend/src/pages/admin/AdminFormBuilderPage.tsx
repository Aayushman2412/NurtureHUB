import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown, Edit3, Save, Eye } from 'lucide-react';
import { Button, Card, Checkbox, FieldLabel, Input, Modal, PageHeader, PageLoader, Select } from '../../components/ui';
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

const FIELD_TYPE_VALUES = ['text', 'number', 'date', 'dropdown', 'radio', 'textarea'] as const;

const AdminFormBuilderPage: React.FC = () => {
  const { t } = useTranslation('adminFormBuilder');
  const fieldTypes = FIELD_TYPE_VALUES.map(value => ({ value, label: t(`fieldTypes.${value}`) }));
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
    if (!confirm(t('confirmRemove'))) return;
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

  if (loading) return <PageLoader label={t('loading')} />;

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
      <FieldLabel size="sm">{t('options.title')}</FieldLabel>
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
          placeholder={t('options.newPlaceholder')}
          value={optionLabel}
          onChange={e => setOptionLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()}
        />
        <Button size="sm" onClick={onAdd}>
          {t('actions.add')}
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
        actions={
          <>
            <Button variant="outline" iconLeft={<Eye className="size-4" />} onClick={() => setShowPreview(!showPreview)}>
              {showPreview ? t('header.hidePreview') : t('header.previewForm')}
            </Button>
            <Button iconLeft={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
              {t('header.addField')}
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
                    {fieldTypes.find(ft => ft.value === field.type)?.label} •{' '}
                    {field.required ? t('field.required') : t('field.optional')}
                    {field.options ? ` • ${t('field.optionsCount', { n: field.options.length })}` : ''}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => moveField(idx, 'up')} disabled={idx === 0} className={iconBtn} title={t('actions.moveUp')}>
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    onClick={() => moveField(idx, 'down')}
                    disabled={idx === fields.length - 1}
                    className={iconBtn}
                    title={t('actions.moveDown')}
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    onClick={() => setEditingField(editingField === field.id ? null : field.id)}
                    className={iconBtn}
                    title={t('actions.edit')}
                  >
                    <Edit3 className="size-4" />
                  </button>
                  <button onClick={() => removeField(field.id)} className={dangerIconBtn} title={t('actions.remove')}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              {editingField === field.id && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel size="sm">{t('editor.label')}</FieldLabel>
                      <Input value={field.label} onChange={e => updateField(field.id, { label: e.target.value })} />
                    </div>
                    <div>
                      <FieldLabel size="sm">{t('editor.type')}</FieldLabel>
                      <Select
                        value={field.type}
                        onChange={e =>
                          updateField(field.id, {
                            type: e.target.value,
                            options: ['dropdown', 'radio'].includes(e.target.value) ? field.options || [] : null,
                          })
                        }
                      >
                        {fieldTypes.map(ft => (
                          <option key={ft.value} value={ft.value}>{ft.label}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <FieldLabel size="sm">{t('editor.placeholder')}</FieldLabel>
                      <Input
                        value={field.placeholder}
                        onChange={e => updateField(field.id, { placeholder: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center pt-6">
                      <Checkbox
                        label={t('field.required')}
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
            <h3 className="mb-4 font-display font-bold text-ink">{t('preview.title')}</h3>
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
                      <option>{field.placeholder || t('preview.selectPlaceholder')}</option>
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
        title={t('addModal.title')}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              {t('actions.cancel')}
            </Button>
            <Button iconLeft={<Save className="size-4" />} onClick={addField} disabled={!newField.label.trim()}>
              {t('header.addField')}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel size="sm">{t('addModal.fieldLabel')}</FieldLabel>
            <Input
              placeholder={t('addModal.labelPlaceholder')}
              value={newField.label}
              onChange={e => setNewField({ ...newField, label: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel size="sm">{t('editor.type')}</FieldLabel>
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
              {fieldTypes.map(ft => (
                <option key={ft.value} value={ft.value}>{ft.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel size="sm">{t('editor.placeholder')}</FieldLabel>
            <Input
              placeholder={t('addModal.placeholderPlaceholder')}
              value={newField.placeholder}
              onChange={e => setNewField({ ...newField, placeholder: e.target.value })}
            />
          </div>
          <div className="flex items-center pt-6">
            <Checkbox
              label={t('field.required')}
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
