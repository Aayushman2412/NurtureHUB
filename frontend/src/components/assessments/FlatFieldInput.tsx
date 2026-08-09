/**
 * Renders a single `FlatField` (from a flat form definition) as an input.
 *
 * Pure presentation + local upload handling: visibility, validation and the
 * submission payload all live in `lib/flatForm.ts`. Choice fields hold option
 * *values*; `checkbox` holds `string[]`, everything else a `string`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { Checkbox, DateInput, Field, Input, Radio, Select } from '../ui';
import { inputClasses } from '../ui/Input';
import { uploadLearnerMedia } from '../../api/forms';
import { isNetworkError } from '../../offline/submit';
import { discardQueuedMedia, enqueue, getMedia, storeMedia, OFFLINE_MEDIA_PREFIX } from '../../offline/queue';
import { cn } from '../../utils/cn';
import { resolveAssetUrl } from '../../lib/flowGraph';
import type { FlatField } from '../../lib/flowTypes';
import { isExclusiveOption } from '../../lib/flowTypes';
import { useToast } from '../../context/ToastContext';

export interface FlatFieldInputProps {
  field: FlatField;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  error?: string;
  disabled?: boolean;
  /** Child's DOB (ISO) — lower bound for `notBeforeDob` date fields. */
  dobIso?: string | null;
  /** Today (ISO) — upper bound for `noFuture` date fields. */
  todayIso: string;
}

const asString = (v: string | string[]): string => (Array.isArray(v) ? '' : v);
const asArray = (v: string | string[]): string[] => (Array.isArray(v) ? v : v ? [v] : []);

const FlatFieldInput: React.FC<FlatFieldInputProps> = ({
  field,
  value,
  onChange,
  error,
  disabled,
  dobIso,
  todayIso,
}) => {
  const { t } = useTranslation('assessments');
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const label = (
    <>
      {field.label}
      {!field.required && (
        <span className="ml-1.5 font-normal text-ink-faint">{t('growth.optional')}</span>
      )}
      {field.helpText && (
        <span className="mt-0.5 block text-xs font-normal text-ink-muted">{field.helpText}</span>
      )}
    </>
  );

  /** Same "none of the above" rule as the flow runner: the exclusive option and
   *  the real answers can never be selected together. */
  const toggleCheckbox = (optionValue: string) => {
    const current = asArray(value);
    const options = field.options ?? [];
    if (current.includes(optionValue)) {
      onChange(current.filter(v => v !== optionValue));
      return;
    }
    const picked = options.find(o => o.value === optionValue);
    if (picked && isExclusiveOption(picked)) {
      onChange([optionValue]);
      return;
    }
    const exclusiveValues = new Set(options.filter(isExclusiveOption).map(o => o.value));
    onChange([...current.filter(v => !exclusiveValues.has(v)), optionValue]);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadLearnerMedia(file);
      onChange(url);
    } catch (err) {
      // Offline: keep the photo on the device. The answer stores an
      // offline-media marker; the sync queue uploads the blob first and
      // rewrites the marker to the real /uploads/ URL before submitting.
      if (isNetworkError(err)) {
        const mediaId = await storeMedia(file);
        await enqueue({
          kind: 'media',
          label: file.name,
          payload: {},
          tempId: mediaId,
        });
        onChange(`${OFFLINE_MEDIA_PREFIX}${mediaId}`);
        showToast(t('photoQueued', { ns: 'offline' }), 'success');
      } else {
        showToast(t('growth.uploadFailed'), 'error');
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const control = () => {
    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            id={field.id}
            className={cn(inputClasses(false, !!error), 'min-h-24 resize-y')}
            placeholder={field.placeholder}
            value={asString(value)}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
          />
        );

      case 'number':
        // `text` + inputMode keeps the raw string so the decimal-places rule in
        // `flatForm.ts` can inspect exactly what was typed.
        return (
          <Input
            id={field.id}
            type="text"
            inputMode="decimal"
            placeholder={field.placeholder}
            value={asString(value)}
            error={!!error}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
          />
        );

      case 'date':
        return (
          <DateInput
            id={field.id}
            value={asString(value)}
            onChange={onChange}
            error={!!error}
            disabled={disabled}
            max={field.noFuture ? todayIso : undefined}
            min={field.notBeforeDob && dobIso ? dobIso.slice(0, 10) : undefined}
            placeholder={field.placeholder}
          />
        );

      case 'dropdown':
        return (
          <Select
            id={field.id}
            value={asString(value)}
            error={!!error}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
          >
            <option value="">{field.placeholder || t('growth.selectPlaceholder')}</option>
            {(field.options ?? []).map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );

      case 'radio':
        return (
          <div className="flex flex-col gap-2">
            {(field.options ?? []).map(o => (
              <Radio
                key={o.value}
                name={field.id}
                label={o.label}
                value={o.value}
                disabled={disabled}
                checked={asString(value) === o.value}
                onChange={() => onChange(o.value)}
              />
            ))}
          </div>
        );

      case 'checkbox':
        return (
          <div className="flex flex-col gap-2">
            {(field.options ?? []).map(o => (
              <Checkbox
                key={o.value}
                label={o.label}
                disabled={disabled}
                checked={asArray(value).includes(o.value)}
                onChange={() => toggleCheckbox(o.value)}
              />
            ))}
          </div>
        );

      case 'image': {
        const url = asString(value);
        return (
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={e => handleFile(e.target.files?.[0])}
            />
            {url ? (
              <div className="relative w-fit">
                {url.startsWith(OFFLINE_MEDIA_PREFIX) ? (
                  <OfflineMediaPreview mediaId={url.slice(OFFLINE_MEDIA_PREFIX.length)} alt={field.label} />
                ) : (
                <img
                  src={resolveAssetUrl(url)}
                  alt={field.label}
                  className="max-h-48 rounded-xl border border-border object-contain"
                />
                )}
                <button
                  type="button"
                  aria-label={t('growth.removePhoto')}
                  disabled={disabled}
                  onClick={() => {
                    // Removing a queued offline photo also drops its queue
                    // item + blob — an orphaned upload would sync uselessly.
                    if (url.startsWith(OFFLINE_MEDIA_PREFIX)) {
                      void discardQueuedMedia(url.slice(OFFLINE_MEDIA_PREFIX.length));
                    }
                    onChange('');
                  }}
                  className="absolute -right-2 -top-2 flex size-7 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-ink-muted shadow-sm hover:text-error-500"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => fileRef.current?.click()}
                className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm font-semibold text-ink-muted transition-colors hover:border-primary hover:text-primary-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {uploading ? t('growth.uploading') : t('growth.choosePhoto')}
              </button>
            )}
          </div>
        );
      }

      default: // 'text'
        return (
          <Input
            id={field.id}
            placeholder={field.placeholder}
            value={asString(value)}
            error={!!error}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
          />
        );
    }
  };

  return (
    <Field label={label} htmlFor={field.id} error={error}>
      {control()}
    </Field>
  );
};

/** Preview for a photo captured offline: streams the blob out of IndexedDB. */
const OfflineMediaPreview: React.FC<{ mediaId: string; alt: string }> = ({ mediaId, alt }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    void getMedia(mediaId).then(media => {
      if (media && active) {
        objectUrl = URL.createObjectURL(media.blob);
        setSrc(objectUrl);
      }
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId]);
  if (!src) return <div className="h-24 w-32 animate-pulse rounded-xl bg-surface-sunken" />;
  return <img src={src} alt={alt} className="max-h-48 rounded-xl border border-dashed border-amber-500/60 object-contain" />;
};

export default FlatFieldInput;
