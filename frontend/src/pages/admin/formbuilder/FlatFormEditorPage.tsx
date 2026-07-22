import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  Edit3,
  Eye,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { adminGetForm, adminSaveForm } from '../../../api/forms';
import { FORM_KEYS } from '../../../lib/flowTypes';
import type {
  FlatField,
  FlatFieldOption,
  FlatSchema,
  FormDefinition,
  FormKey,
} from '../../../lib/flowTypes';
import { useToast } from '../../../context/ToastContext';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FieldLabel,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Select,
} from '../../../components/ui';
import { inputClasses } from '../../../components/ui/Input';
import { cn } from '../../../utils/cn';
import { useDirtyGuard } from '../../../components/flowbuilder/useDirtyGuard';

const FIELD_TYPE_VALUES: FlatField['type'][] = [
  'text', 'number', 'date', 'dropdown', 'radio', 'textarea', 'checkbox', 'image',
];

/** Parse a numeric-input string → number | null (blank clears the setting). */
const numOrNull = (raw: string): number | null => {
  const v = raw.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const TYPE_ICONS: Record<FlatField['type'], string> = {
  text: '📝',
  number: '🔢',
  date: '📅',
  dropdown: '📋',
  radio: '🔘',
  textarea: '📄',
  checkbox: '☑️',
  image: '🖼️',
};

const emptyNewField = (): FlatField => ({
  id: '',
  label: '',
  type: 'text',
  placeholder: '',
  required: true,
  options: null,
});

/** Options editor used by both the inline field editor and the add-field modal. */
const OptionsEditor: React.FC<{
  title: string;
  addLabel: string;
  placeholder: string;
  options: FlatFieldOption[];
  onRemove: (i: number) => void;
  optionLabel: string;
  setOptionLabel: (v: string) => void;
  onAdd: () => void;
}> = ({ title, addLabel, placeholder, options, onRemove, optionLabel, setOptionLabel, onAdd }) => (
  <div className="mt-4">
    <FieldLabel size="sm">{title}</FieldLabel>
    <div className="flex flex-wrap gap-2">
      {options.map((opt, oi) => (
        <span
          key={oi}
          className="inline-flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-1.5 text-sm text-ink"
        >
          {opt.label}
          <button
            type="button"
            onClick={() => onRemove(oi)}
            className="text-ink-faint hover:text-error-500 cursor-pointer"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      ))}
    </div>
    <div className="mt-2 flex gap-2">
      <Input
        placeholder={placeholder}
        value={optionLabel}
        onChange={e => setOptionLabel(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onAdd()}
      />
      <Button size="sm" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  </div>
);

/**
 * Field-list editor for flat forms (registration/growth/antenatal). Keeps the
 * classic form-builder UX but loads/saves a versioned form definition.
 */
const FlatFormEditorPage: React.FC = () => {
  const { formKey } = useParams<{ formKey: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('adminFormBuilder');
  const { showToast } = useToast();
  const fieldTypes = FIELD_TYPE_VALUES.map(value => ({ value, label: t(`fieldTypes.${value}`) }));

  const [def, setDef] = useState<FormDefinition | null>(null);
  const [fields, setFields] = useState<FlatField[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [reloadTick, setReloadTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [newField, setNewField] = useState<FlatField>(emptyNewField());
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [editOptionLabel, setEditOptionLabel] = useState('');

  const validKey = !!formKey && (FORM_KEYS as readonly string[]).includes(formKey);
  useDirtyGuard(dirty);

  useEffect(() => {
    if (!formKey || !(FORM_KEYS as readonly string[]).includes(formKey)) return;
    let cancelled = false;
    setLoadState('loading');
    adminGetForm(formKey as FormKey)
      .then(d => {
        if (cancelled) return;
        if (d.builder_type !== 'flat') {
          navigate(`/admin/form-builder/flow/${formKey}`, { replace: true });
          return;
        }
        const schema = d.schema_json as FlatSchema;
        setDef(d);
        setFields(schema && Array.isArray(schema.fields) ? schema.fields : []);
        setDirty(false);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [formKey, navigate, reloadTick]);

  const applyFields = (updated: FlatField[]) => {
    setFields(updated);
    setDirty(true);
  };

  const save = async () => {
    if (!formKey) return;
    setSaving(true);
    try {
      const updated = await adminSaveForm(formKey as FormKey, { schema_json: { fields } });
      setDef(updated);
      setDirty(false);
      showToast(`Saved — version ${updated.version} is live for learners`, 'success');
    } catch {
      showToast('Could not save the form. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    const next = [...fields];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    [next[index], next[targetIdx]] = [next[targetIdx], next[index]];
    applyFields(next);
  };

  const removeField = (id: string) => {
    if (!window.confirm(t('confirmRemove'))) return;
    applyFields(fields.filter(f => f.id !== id));
  };

  const addField = () => {
    if (!newField.label.trim()) return;
    const id =
      newField.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();
    const field: FlatField = { ...newField, id };
    if (['dropdown', 'radio'].includes(field.type) && !field.options) field.options = [];
    applyFields([...fields, field]);
    setNewField(emptyNewField());
    setShowAddModal(false);
  };

  const updateField = (id: string, updates: Partial<FlatField>) =>
    applyFields(fields.map(f => (f.id === id ? { ...f, ...updates } : f)));

  const addOptionToField = (fieldId: string) => {
    if (!editOptionLabel.trim()) return;
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;
    const newOpt: FlatFieldOption = {
      label: editOptionLabel.trim(),
      value: editOptionLabel.trim().toLowerCase().replace(/\s+/g, '_'),
    };
    updateField(fieldId, { options: [...(field.options || []), newOpt] });
    setEditOptionLabel('');
  };

  const removeOptionFromField = (fieldId: string, optIndex: number) => {
    const field = fields.find(f => f.id === fieldId);
    if (!field || !field.options) return;
    updateField(fieldId, { options: field.options.filter((_, i) => i !== optIndex) });
  };

  const addOptionToNewField = () => {
    if (!newOptionLabel.trim()) return;
    const newOpt: FlatFieldOption = {
      label: newOptionLabel.trim(),
      value: newOptionLabel.trim().toLowerCase().replace(/\s+/g, '_'),
    };
    setNewField({ ...newField, options: [...(newField.options || []), newOpt] });
    setNewOptionLabel('');
  };

  if (!validKey) {
    return (
      <Alert variant="error" title="Unknown form">
        This form key does not exist. Head back to the{' '}
        <a href="/admin/form-builder" className="font-bold underline">
          Form Builder
        </a>
        .
      </Alert>
    );
  }

  if (loadState === 'loading') return <PageLoader label={t('loading')} />;

  if (loadState === 'error') {
    return (
      <div className="space-y-4">
        <Alert variant="error" title="Could not load this form">
          Check your connection and try again.
        </Alert>
        <Button variant="outline" onClick={() => setReloadTick(tick => tick + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  const iconBtn =
    'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer disabled:opacity-40 disabled:pointer-events-none';
  const dangerIconBtn =
    'flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10';

  return (
    <div>
      <PageHeader
        backTo="/admin/form-builder"
        title={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            {def?.title ?? t('header.title')}
            <Badge variant="neutral">Field list</Badge>
            {def && <Badge variant="coral">v{def.version}</Badge>}
          </span>
        }
        description="Add, remove and reorder fields. Click Save to publish your changes to learners."
        actions={
          <>
            {dirty && (
              <span
                className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-500"
                title="You have unsaved changes"
              >
                <span className="size-2 animate-pulse rounded-full bg-amber-500" />
                Unsaved
              </span>
            )}
            <Button
              variant="outline"
              iconLeft={<Eye className="size-4" />}
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? t('header.hidePreview') : t('header.previewForm')}
            </Button>
            <Button variant="outline" iconLeft={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
              {t('header.addField')}
            </Button>
            <Button iconLeft={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={save}>
              Save
            </Button>
          </>
        }
      />

      <div className={cn('grid gap-6', showPreview ? 'lg:grid-cols-2' : 'grid-cols-1')}>
        {/* Fields */}
        <div className="flex flex-col gap-3">
          {fields.length === 0 && (
            <Card className="p-8 text-center text-sm text-ink-muted">
              No fields yet — add the first one with “{t('header.addField')}”.
            </Card>
          )}
          {fields.map((field, idx) => (
            <Card key={field.id} className="p-4">
              <div className="flex items-center gap-3">
                <GripVertical className="size-4 shrink-0 text-ink-faint" />
                <span className="text-xl">{TYPE_ICONS[field.type]}</span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{field.label}</span>
                  <span className="text-xs text-ink-faint">
                    {fieldTypes.find(ft => ft.value === field.type)?.label} •{' '}
                    {field.required ? t('field.required') : t('field.optional')}
                    {field.options ? ` • ${t('field.optionsCount', { n: field.options.length })}` : ''}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => moveField(idx, 'up')}
                    disabled={idx === 0}
                    className={iconBtn}
                    title={t('actions.moveUp')}
                  >
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
                            type: e.target.value as FlatField['type'],
                            options: ['dropdown', 'radio'].includes(e.target.value) ? field.options || [] : null,
                          })
                        }
                      >
                        {fieldTypes.map(ft => (
                          <option key={ft.value} value={ft.value}>
                            {ft.label}
                          </option>
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
                      title={t('options.title')}
                      addLabel={t('actions.add')}
                      placeholder={t('options.newPlaceholder')}
                      options={field.options}
                      onRemove={oi => removeOptionFromField(field.id, oi)}
                      optionLabel={editOptionLabel}
                      setOptionLabel={setEditOptionLabel}
                      onAdd={() => addOptionToField(field.id)}
                    />
                  )}

                  {field.type === 'number' && (
                    <div className="mt-4 rounded-lg border border-border p-3">
                      <FieldLabel size="sm" className="mb-2">
                        {t('numeric.title')}
                      </FieldLabel>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div>
                          <FieldLabel size="sm">{t('numeric.decimals')}</FieldLabel>
                          <Input
                            type="number"
                            min={0}
                            max={4}
                            value={field.decimals ?? ''}
                            onChange={e => updateField(field.id, { decimals: numOrNull(e.target.value) })}
                            placeholder="1"
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('numeric.flagMin')}</FieldLabel>
                          <Input
                            type="number"
                            value={field.flagMin ?? ''}
                            onChange={e => updateField(field.id, { flagMin: numOrNull(e.target.value) })}
                            placeholder={t('numeric.min')}
                          />
                        </div>
                        <div>
                          <FieldLabel size="sm">{t('numeric.flagMax')}</FieldLabel>
                          <Input
                            type="number"
                            value={field.flagMax ?? ''}
                            onChange={e => updateField(field.id, { flagMax: numOrNull(e.target.value) })}
                            placeholder={t('numeric.max')}
                          />
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('numeric.hint')}</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>

        {/* Preview */}
        {showPreview && (
          <Card className="h-fit p-6">
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
                    <textarea
                      className={cn(inputClasses(), 'resize-y')}
                      placeholder={field.placeholder}
                      rows={3}
                      readOnly
                    />
                  )}
                  {field.type === 'dropdown' && (
                    <Select defaultValue="">
                      <option value="">{field.placeholder || t('preview.selectPlaceholder')}</option>
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
            <Button iconLeft={<Plus className="size-4" />} onClick={addField} disabled={!newField.label.trim()}>
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
                  type: e.target.value as FlatField['type'],
                  options: ['dropdown', 'radio'].includes(e.target.value) ? [] : null,
                })
              }
            >
              {fieldTypes.map(ft => (
                <option key={ft.value} value={ft.value}>
                  {ft.label}
                </option>
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
            title={t('options.title')}
            addLabel={t('actions.add')}
            placeholder={t('options.newPlaceholder')}
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

export default FlatFormEditorPage;
