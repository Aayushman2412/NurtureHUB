import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Loader2, Save, X } from 'lucide-react';
import { Button, FieldLabel, Input } from '../ui';
import { inputClasses } from '../ui/Input';
import { cn } from '../../utils/cn';
import { resolveAssetUrl } from '../../lib/flowGraph';
import { OPTION_LABELS, uploadTestImage, type AdminQuestion } from '../../api/adminTests';

interface ImagePickerProps {
  url: string;
  onChange: (url: string) => void;
  /** Compact variant used inside an option row. */
  small?: boolean;
  label: string;
}

/**
 * Attach one picture to a question or an option. Uploads immediately (so the
 * URL is real before the question is saved) and previews inline.
 */
const ImagePicker: React.FC<ImagePickerProps> = ({ url, onChange, small, label }) => {
  const { t } = useTranslation('adminTests');
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    uploadTestImage(file)
      .then(onChange)
      .catch((err: { response?: { data?: { detail?: string } } }) =>
        setError(err?.response?.data?.detail || t('images.uploadFailed')),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className={cn('flex items-center gap-2', small ? 'shrink-0' : 'mt-1')}>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={pick} />
      {url ? (
        <span className="flex items-center gap-1.5">
          <img
            src={resolveAssetUrl(url)}
            alt={label}
            className={cn(
              'rounded-lg border border-border object-cover',
              small ? 'size-10' : 'h-24 w-32',
            )}
          />
          <button
            type="button"
            title={t('images.remove')}
            onClick={() => onChange('')}
            className="flex size-7 items-center justify-center rounded-lg text-ink-muted hover:bg-error-50 hover:text-error-500 cursor-pointer dark:hover:bg-error-500/10"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border border-dashed border-border-strong/60 px-2.5 text-ink-muted',
            'hover:border-coral-500 hover:text-coral-600 cursor-pointer disabled:opacity-50 dark:hover:text-coral-300',
            small ? 'h-10 text-[11px]' : 'h-9 text-xs',
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {small ? '' : t('images.add')}
        </button>
      )}
      {error && <span className="text-[11px] text-error-600">{error}</span>}
    </div>
  );
};

interface Props {
  value: AdminQuestion;
  onChange: (next: AdminQuestion) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Marks applied when this question leaves its own marks blank. */
  defaultMarks: number;
  /** The test already has submitted attempts — clearing an option is refused. */
  locked: boolean;
  error?: string;
}

/**
 * Write or correct one question by hand: wording, an optional picture, up to
 * six options (each of which may itself be a picture), the correct answer and
 * the marks it carries.
 */
const TestQuestionEditor: React.FC<Props> = ({
  value, onChange, onSave, onCancel, saving, defaultMarks, locked, error,
}) => {
  const { t } = useTranslation('adminTests');
  const set = (patch: Partial<AdminQuestion>) => onChange({ ...value, ...patch });

  const filled = OPTION_LABELS.filter(label => {
    const key = `option_${label.toLowerCase()}` as keyof AdminQuestion;
    const img = `option_${label.toLowerCase()}_image` as keyof AdminQuestion;
    return String(value[key] ?? '').trim() || String(value[img] ?? '').trim();
  });
  const canSave = !!value.text.trim() && filled.length >= 2;

  return (
    <div className="rounded-xl border border-coral-500/30 bg-coral-50/40 p-4 dark:bg-coral-500/5">
      <div>
        <FieldLabel size="sm">{t('editor.questionText')} *</FieldLabel>
        <textarea
          className={cn(inputClasses(), 'resize-y')}
          rows={2}
          placeholder={t('editor.questionPlaceholder')}
          value={value.text}
          onChange={e => set({ text: e.target.value })}
        />
      </div>

      <div className="mt-3">
        <FieldLabel size="sm">{t('editor.questionImage')}</FieldLabel>
        <ImagePicker url={value.image_url} onChange={url => set({ image_url: url })} label={t('editor.questionImage')} />
        <p className="mt-1 text-[11px] text-ink-faint">{t('editor.questionImageHint')}</p>
      </div>

      <div className="mt-4">
        <FieldLabel size="sm">{t('editor.options')}</FieldLabel>
        <p className="mb-2 text-[11px] text-ink-faint">{t('editor.optionsHint')}</p>
        <div className="flex flex-col gap-2">
          {OPTION_LABELS.map(label => {
            const key = `option_${label.toLowerCase()}` as keyof AdminQuestion;
            const imgKey = `option_${label.toLowerCase()}_image` as keyof AdminQuestion;
            const isCorrect = value.correct_answer === label;
            return (
              <div
                key={label}
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-2',
                  isCorrect ? 'border-success-500/50 bg-success-50/50 dark:bg-success-500/5' : 'border-border',
                )}
              >
                <label
                  className="flex shrink-0 cursor-pointer items-center gap-1.5"
                  title={t('editor.markCorrect')}
                >
                  <input
                    type="radio"
                    name={`correct-${value.id}`}
                    checked={isCorrect}
                    onChange={() => set({ correct_answer: label })}
                    className="size-4 accent-success-500"
                  />
                  <span className="w-4 text-xs font-bold text-ink-muted">{label}</span>
                </label>
                <Input
                  className="flex-1"
                  placeholder={t('editor.optionPlaceholder', { label })}
                  value={String(value[key] ?? '')}
                  onChange={e => set({ [key]: e.target.value } as Partial<AdminQuestion>)}
                />
                <ImagePicker
                  small
                  url={String(value[imgKey] ?? '')}
                  onChange={url => set({ [imgKey]: url } as Partial<AdminQuestion>)}
                  label={t('editor.optionPlaceholder', { label })}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 max-w-[220px]">
        <FieldLabel size="sm">{t('editor.marks')}</FieldLabel>
        <Input
          type="number"
          min={0}
          value={value.marks || ''}
          placeholder={t('editor.marksDefault', { n: defaultMarks })}
          onChange={e => set({ marks: parseInt(e.target.value, 10) || 0 })}
        />
        <p className="mt-1 text-[11px] text-ink-faint">{t('editor.marksHint', { n: defaultMarks })}</p>
      </div>

      {locked && <p className="mt-3 text-[13px] text-warning-700 dark:text-warning-300">{t('editor.lockedNote')}</p>}
      {error && <p className="mt-3 text-[13px] text-error-600">{error}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[11px] text-ink-faint">
          {canSave ? '' : t('editor.needTwoOptions')}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {t('actions.cancel')}
          </Button>
          <Button
            iconLeft={saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            onClick={onSave}
            disabled={saving || !canSave}
          >
            {t('editor.save')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export { ImagePicker };
export default TestQuestionEditor;
