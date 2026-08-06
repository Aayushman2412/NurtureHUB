import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCommitHorizontal, ListChecks } from 'lucide-react';
import { Button, DateInput, Field, Modal } from '../../../components/ui';

export interface SaveVersionPayload {
  created_on: string;   // ISO date
  description: string;
  make_default: boolean;
  /** Auto-detected diff vs the version this edit started from. */
  detected_changes: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** vN this save will create. */
  nextVersionNumber?: number;
  /** Whether "make default" starts checked (true when editing the live/default version). */
  defaultMakeDefault: boolean;
  /** What the builder detected changed — shown read-only beside the admin's note. */
  detectedChanges: string[];
  saving: boolean;
  onSave: (payload: SaveVersionPayload) => void;
}

/** Show a handful inline; the rest collapse behind a "+N more" line. */
const VISIBLE_CHANGES = 6;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The "commit" dialog: every builder save records an immutable version with an
 * admin-entered creation date and a description of what changed.
 */
const SaveVersionDialog: React.FC<Props> = ({
  open,
  onClose,
  nextVersionNumber,
  defaultMakeDefault,
  detectedChanges,
  saving,
  onSave,
}) => {
  const { t } = useTranslation('adminFormBuilder');
  const [createdOn, setCreatedOn] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [makeDefault, setMakeDefault] = useState(defaultMakeDefault);
  const [touched, setTouched] = useState(false);

  // The dialog stays mounted between opens (so an accidental Esc keeps the
  // typed text) — but the default-toggle must track the version being edited.
  useEffect(() => {
    if (open) {
      setMakeDefault(defaultMakeDefault);
      setTouched(false);
    }
  }, [open, defaultMakeDefault]);

  const descriptionMissing = !description.trim();
  // The masked text input can commit any typed date — block future ones here
  // (the backend rejects them too).
  const dateInFuture = !!createdOn && createdOn > todayIso();

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <GitCommitHorizontal className="size-5 text-primary-ink" />
          {nextVersionNumber
            ? t('saveVersion.titleN', { n: nextVersionNumber })
            : t('saveVersion.title')}
        </span>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('saveVersion.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={saving || descriptionMissing || dateInFuture}
            onClick={() =>
              onSave({
                created_on: createdOn || todayIso(),
                description: description.trim(),
                make_default: makeDefault,
                detected_changes: detectedChanges,
              })
            }
          >
            {saving ? t('saveVersion.saving') : t('saveVersion.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">{t('saveVersion.blurb')}</p>

        {/* What the builder itself detected — recorded with the version. */}
        <div className="rounded-lg border border-border bg-surface-sunken/60 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
            <ListChecks className="size-3.5" />
            {t('saveVersion.detected')}
            {detectedChanges.length > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary-ink">
                {detectedChanges.length}
              </span>
            )}
          </div>
          {detectedChanges.length === 0 ? (
            <p className="text-xs text-ink-faint">{t('saveVersion.detectedNone')}</p>
          ) : (
            <ul className="space-y-0.5 text-xs text-ink">
              {detectedChanges.slice(0, VISIBLE_CHANGES).map((change, i) => (
                <li key={`${i}-${change}`} className="flex gap-1.5">
                  <span className="text-ink-faint">•</span>
                  <span>{change}</span>
                </li>
              ))}
              {detectedChanges.length > VISIBLE_CHANGES && (
                <li className="text-ink-faint">
                  {t('saveVersion.detectedMore', { count: detectedChanges.length - VISIBLE_CHANGES })}
                </li>
              )}
            </ul>
          )}
        </div>

        <Field
          label={`${t('saveVersion.dateLabel')} *`}
          error={dateInFuture ? t('saveVersion.dateFuture') : undefined}
        >
          <DateInput value={createdOn} onChange={setCreatedOn} max={todayIso()} error={dateInFuture} />
        </Field>

        <Field
          label={`${t('saveVersion.descriptionLabel')} *`}
          error={touched && descriptionMissing ? t('saveVersion.descriptionRequired') : undefined}
        >
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            placeholder={t('saveVersion.descriptionPlaceholder')}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink
                       placeholder:text-ink-faint focus:border-primary focus:outline-none"
          />
        </Field>

        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={e => setMakeDefault(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span>
            <span className="font-medium">{t('saveVersion.makeDefault')}</span>
            <span className="block text-xs text-ink-muted">{t('saveVersion.makeDefaultHint')}</span>
          </span>
        </label>
      </div>
    </Modal>
  );
};

export default SaveVersionDialog;
