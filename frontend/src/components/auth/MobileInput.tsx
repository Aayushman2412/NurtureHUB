import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

/**
 * A ten-digit Indian mobile number: "+91" shown in front, digits only, the
 * phone's number pad. Pasting "+91 98765 43210" keeps the ten digits.
 */
const MobileInput: React.FC<{
  id: string;
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean;
}> = ({ id, value, onChange, disabled, autoFocus, error }) => {
  const { t } = useTranslation('auth');
  const clean = (raw: string) => {
    let digits = raw.replace(/\D/g, '');
    if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
    return digits.slice(0, 10);
  };
  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden rounded-lg border bg-surface transition-colors focus-within:ring-2 focus-within:ring-primary/30',
        error ? 'border-error-500' : 'border-border-strong/60 focus-within:border-primary',
        disabled && 'opacity-60',
      )}
    >
      <span className="flex items-center border-r border-border bg-surface-sunken px-3 text-sm font-semibold text-ink-muted" aria-hidden>
        +91
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={14}
        placeholder={t('fields.mobilePlaceholder')}
        value={value}
        onChange={e => onChange(clean(e.target.value))}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error || undefined}
        className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-base tracking-wide text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
};

export default MobileInput;
