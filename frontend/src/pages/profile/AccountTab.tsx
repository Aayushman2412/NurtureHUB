import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, KeyRound, Mail, Smartphone } from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import PasswordRules from '../../components/auth/PasswordRules';
import { usePasswordCheck } from '../../hooks/usePasswordCheck';
import { Badge, Button, Field, Input, PasswordInput } from '../../components/ui';

const detailOf = (err: any, fallback: string) => {
  const d = err?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

/**
 * How this learner signs in (review of 17 Oct 2026): the mobile number, the
 * email address — optional, added and confirmed whenever they like — and the
 * password, which an easy one invites them to change. Separate from the
 * profile form: each part saves on its own.
 */
const AccountTab: React.FC = () => {
  const { t } = useTranslation('learner');
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState(user?.contact_email ?? '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState<'email' | 'verify' | 'password' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const pw = usePasswordCheck(next, { fullName: user?.full_name ?? undefined, includeHistory: true });
  const placeholder = Boolean(user?.email_is_placeholder);

  const saveEmail = async () => {
    setBusy('email');
    try {
      const res = await client.post('/api/auth/contact-email', { email: email.trim() });
      setCodeSent(Boolean(res.data.code_sent));
      showToast(t(res.data.code_sent ? 'account.codeSent' : 'account.emailSaved'), 'success');
      await refreshUser();
    } catch (err) {
      showToast(detailOf(err, t('account.emailFailed')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const verifyEmail = async () => {
    setBusy('verify');
    try {
      await client.post('/api/auth/contact-email/verify', { code: code.trim() });
      showToast(t('account.emailVerified'), 'success');
      setCode('');
      setCodeSent(false);
      await refreshUser();
    } catch (err) {
      showToast(detailOf(err, t('account.codeWrong')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw.ok) { showToast(t('account.passwordRules'), 'warning'); return; }
    setBusy('password');
    try {
      await client.post('/api/auth/change-password', { current_password: current, new_password: next });
      showToast(t('account.passwordChanged'), 'success');
      setCurrent('');
      setNext('');
      await refreshUser();
    } catch (err) {
      showToast(detailOf(err, t('account.passwordFailed')), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-ink"><Smartphone className="size-4" />{t('account.mobile')}</h4>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tabular-nums text-ink">{user?.phone ? `+91 ${user.phone}` : t('account.noMobile')}</span>
          {user?.phone && (user.phone_verified
            ? <Badge variant="success" size="sm"><BadgeCheck className="mr-1 size-3" />{t('account.confirmed')}</Badge>
            : <Badge variant="neutral" size="sm">{t('account.notConfirmed')}</Badge>)}
        </div>
        <p className="text-xs text-ink-muted">{t('account.mobileHint')}</p>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-5">
        <h4 className="flex items-center gap-2 text-sm font-bold text-ink"><Mail className="size-4" />{t('account.email')}</h4>
        {!placeholder ? (
          <p className="text-sm text-ink">{user?.email}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {user?.contact_email
                ? <><span className="text-ink">{user.contact_email}</span>
                  {user.contact_email_verified
                    ? <Badge variant="success" size="sm"><BadgeCheck className="mr-1 size-3" />{t('account.confirmed')}</Badge>
                    : <Badge variant="neutral" size="sm">{t('account.notConfirmed')}</Badge>}</>
                : <span className="text-ink-muted">{t('account.noEmail')}</span>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder={t('fields.contactEmailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} />
              <Button type="button" variant="outline" loading={busy === 'email'} disabled={!email.trim()} onClick={() => void saveEmail()}>
                {user?.contact_email && !user.contact_email_verified && user.contact_email === email.trim()
                  ? t('account.resendCode') : t('account.saveEmail')}
              </Button>
            </div>
            {(codeSent || (user?.contact_email && !user.contact_email_verified)) && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder={t('account.codePlaceholder')}
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                <Button type="button" loading={busy === 'verify'} disabled={code.length < 6} onClick={() => void verifyEmail()}>
                  {t('account.confirmEmail')}
                </Button>
              </div>
            )}
            <p className="text-xs text-ink-muted">{t('account.emailHint')}</p>
          </>
        )}
      </section>

      <form onSubmit={changePassword} className="flex flex-col gap-3 border-t border-border pt-5">
        <h4 className="flex items-center gap-2 text-sm font-bold text-ink"><KeyRound className="size-4" />{t('account.password')}</h4>
        {user?.password_weak && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {t('account.weak')}
          </p>
        )}
        <Field label={t('account.currentPassword')} htmlFor="current-password">
          <PasswordInput id="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
        </Field>
        <Field label={t('account.newPassword')} htmlFor="new-password">
          <PasswordInput id="new-password" value={next} onChange={e => setNext(e.target.value)} required autoComplete="new-password" />
        </Field>
        <PasswordRules password={next} policy={pw.policy} results={pw.results} easy={pw.easy} showTip={false} />
        <div className="flex justify-end">
          <Button type="submit" loading={busy === 'password'} disabled={!current || !next}>{t('account.changePassword')}</Button>
        </div>
      </form>
    </div>
  );
};

export default AccountTab;
