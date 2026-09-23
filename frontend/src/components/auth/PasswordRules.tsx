/**
 * The password rules, listed under the password box and ticked off as the
 * person types. Shown wherever a password is created: sign-up, reset, and the
 * admin's "create account" form.
 *
 * Grey circle = not typed yet; green tick = met; red cross = not met yet. The
 * "not one of your last N passwords" rule can only be checked by the server,
 * so it says so rather than pretending.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Circle, Clock, ShieldCheck, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { characterKinds, type PasswordPolicy, type RuleResult } from '../../lib/passwordRules';

interface Props {
  password: string;
  policy: PasswordPolicy;
  results: RuleResult[];
  /** Show the passphrase tip (learner-facing screens). */
  showTip?: boolean;
  className?: string;
  id?: string;
}

const PasswordRules: React.FC<Props> = ({ password, policy, results, showTip = true, className, id }) => {
  const { t } = useTranslation('auth');
  const kinds = characterKinds(password.normalize('NFKC'));
  const checkable = results.filter(r => r.id !== 'history');
  const met = checkable.filter(r => r.status === 'pass').length;
  const typed = password.length > 0;
  const allMet = typed && met === checkable.length;

  const text = (r: RuleResult) => t(`passwordRules.rule.${r.id}`, {
    min: policy.min_length,
    max: policy.max_length,
    kinds: policy.min_character_kinds,
    passphrase: policy.passphrase_length,
    repeat: policy.max_repeat + 1,
    distinct: policy.min_distinct_characters,
    n: policy.history_depth,
  });

  return (
    <div
      id={id}
      className={cn(
        'rounded-xl border p-3.5 transition-colors',
        allMet ? 'border-success-500/40 bg-success-50 dark:bg-success-500/10' : 'border-border bg-surface-sunken',
        className,
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ShieldCheck className={cn('size-4', allMet ? 'text-success-600' : 'text-primary-ink')} aria-hidden />
          {allMet ? t('passwordRules.allMet') : t('passwordRules.title')}
        </span>
        <span className="text-xs tabular-nums text-ink-muted" aria-live="polite">
          {t('passwordRules.progress', { n: typed ? met : 0, total: checkable.length })}
        </span>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className={cn('h-full rounded-full transition-all duration-300', allMet ? 'bg-success-500' : met >= checkable.length - 1 ? 'bg-amber-500' : 'bg-error-500')}
          style={{ width: `${typed ? (met / checkable.length) * 100 : 0}%` }}
        />
      </div>

      <ul className="space-y-1.5">
        {results.map(r => (
          <li key={r.id} className="flex items-start gap-2 text-sm leading-snug">
            <span
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                r.status === 'pass' && 'bg-success-500 text-white',
                r.status === 'fail' && 'bg-error-500 text-white',
                r.status === 'pending' && 'text-ink-faint',
              )}
              aria-hidden
            >
              {r.id === 'history' ? <Clock className="size-3.5" />
                : r.status === 'pass' ? <Check className="size-3" strokeWidth={3} />
                  : r.status === 'fail' ? <X className="size-3" strokeWidth={3} />
                    : <Circle className="size-3.5" />}
            </span>
            <span className={cn(
              r.status === 'pass' && 'text-ink',
              r.status === 'fail' && 'text-error-600',
              r.status === 'pending' && 'text-ink-muted',
            )}>
              <span className="sr-only">
                {r.id === 'history' ? t('passwordRules.sr.server')
                  : r.status === 'pass' ? t('passwordRules.sr.met')
                    : r.status === 'fail' ? t('passwordRules.sr.notMet') : t('passwordRules.sr.notYet')}
                {': '}
              </span>
              {text(r)}
              {r.id === 'variety' && (
                <span className="mt-1 flex flex-wrap gap-1" aria-hidden>
                  {([
                    ['lower', 'abc'], ['upper', 'ABC'], ['digit', '123'], ['symbol', '#@!'],
                  ] as [keyof typeof kinds, string][]).map(([k, label]) => (
                    <span
                      key={k}
                      title={t(`passwordRules.kinds.${k}`)}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold transition-colors',
                        kinds[k]
                          ? 'border-success-500/50 bg-success-50 text-success-600 dark:bg-success-500/15'
                          : 'border-border bg-surface text-ink-faint',
                      )}
                    >
                      {label}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {showTip && <p className="mt-3 text-xs leading-relaxed text-ink-muted">{t('passwordRules.tip')}</p>}
    </div>
  );
};

export default PasswordRules;
