import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { MapPin, Mail, Smartphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import MobileInput from '../components/auth/MobileInput';
import PasswordRules from '../components/auth/PasswordRules';
import { usePasswordCheck } from '../hooks/usePasswordCheck';
import { useSignInOptions } from '../hooks/useSignInOptions';
import { getRegistrationScope, joinProjectSlug, type RegistrationScope } from '../api/registration';
import { Button, Divider, FieldLabel, Input, PasswordInput } from '../components/ui';

/**
 * Create an account — mobile number first (review of 17 Oct 2026). Sir: "let's
 * not take email as the first step … first mobile, OTP, then you go further;
 * email would be the last information which you collect." Name, mobile number
 * and a password; a WhatsApp code confirms the number when WhatsApp is set
 * up. Signing up with an email address stays possible, as the second way.
 */
const SignupPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [useEmail, setUseEmail] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<RegistrationScope | null>(null);
  const pw = usePasswordCheck(password, { email: useEmail ? email : undefined, fullName });
  const options = useSignInOptions();

  const { register, registerMobile } = useAuth();
  const { showToast, updateToast } = useToast();
  const navigate = useNavigate();
  const joining = joinProjectSlug();

  // Arrived through a project's sign-up link: say which project.
  useEffect(() => {
    if (joining) getRegistrationScope(joining).then(setScope).catch(() => {});
  }, [joining]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !password || (useEmail ? !email : mobile.length !== 10)) {
      showToast(useEmail ? t('signup.toast.fillAll') : t('signup.toast.fillAllMobile'), 'warning');
      return;
    }
    if (!pw.ok) {
      showToast(t('signup.toast.passwordMin'), 'warning');
      document.getElementById('password-input')?.focus();
      return;
    }
    setLoading(true);
    const toastId = showToast(t('signup.toast.creating'), 'loading');
    try {
      if (useEmail) {
        await register(email, password, fullName);
        updateToast(toastId, t('signup.toast.created'), 'success');
        navigate('/verify');
        return;
      }
      const res = await registerMobile(fullName, mobile, password);
      if (res.otp_channel === 'whatsapp') {
        updateToast(toastId, t('signup.toast.codeSent'), 'success');
        navigate('/verify?via=whatsapp');
      } else {
        updateToast(toastId, t('signup.toast.createdMobile'), 'success');
        navigate('/register');
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      updateToast(toastId, typeof detail === 'string' ? detail : t('signup.toast.failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t('signup.title')} subtitle={t('signup.subtitleMobile')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {scope?.locked && (
          <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm text-ink">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary-ink" />
            <span>{t('signup.joining', {
              project: scope.locked.project.name,
              place: [scope.locked.district?.name, scope.locked.state?.name].filter(Boolean).join(', '),
            })}</span>
          </div>
        )}
        {scope?.link_closed && (
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {t('signup.linkClosed')}
          </p>
        )}

        <div>
          <FieldLabel htmlFor="fullname-input">{t('fields.fullName')}</FieldLabel>
          <Input
            id="fullname-input" type="text" autoComplete="name"
            placeholder={t('fields.fullNamePlaceholder')}
            value={fullName} onChange={e => setFullName(e.target.value)} required disabled={loading}
          />
        </div>

        {useEmail ? (
          <div>
            <FieldLabel htmlFor="email-input">{t('fields.email')}</FieldLabel>
            <Input
              id="email-input" type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder={t('signup.emailPlaceholder')}
              value={email} onChange={e => setEmail(e.target.value)} required disabled={loading}
            />
          </div>
        ) : (
          <div>
            <FieldLabel htmlFor="mobile-input">{t('fields.mobile')}</FieldLabel>
            <MobileInput id="mobile-input" value={mobile} onChange={setMobile} disabled={loading} />
            <p className="mt-1.5 text-xs text-ink-muted">
              {options.whatsapp_otp ? t('signup.mobileHintWhatsapp') : t('signup.mobileHintLater')}
            </p>
          </div>
        )}

        <div>
          <FieldLabel htmlFor="password-input">{t('fields.password')}</FieldLabel>
          <PasswordInput
            id="password-input"
            placeholder={t('fields.passwordMin', { n: pw.policy.min_length })}
            value={password} onChange={e => setPassword(e.target.value)} required disabled={loading}
            autoComplete="new-password" aria-describedby="password-rules"
          />
          <PasswordRules
            id="password-rules" className="mt-2.5" password={password}
            policy={pw.policy} results={pw.results} easy={pw.easy}
          />
        </div>

        <Button type="submit" size="lg" fullWidth loading={loading} className="mt-1">
          {loading ? t('signup.creating') : t('signup.submit')}
        </Button>

        {!useEmail && <p className="-mt-2 text-center text-xs text-ink-muted">{t('signup.emailLater')}</p>}

        <button
          type="button" onClick={() => setUseEmail(v => !v)} disabled={loading}
          className="mx-auto inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-primary-ink hover:text-primary-ink-hover"
        >
          {useEmail ? <Smartphone className="size-4" /> : <Mail className="size-4" />}
          {useEmail ? t('signup.useMobile') : t('signup.useEmail')}
        </button>

        {options.google && (
          <>
            <Divider label={t('signup.orSignUpWith')} className="my-1" />
            <GoogleButton />
            <p className="-mt-1 text-center text-xs leading-relaxed text-ink-muted">{t('signup.googleNote')}</p>
          </>
        )}

        <p className="mt-2 text-center text-sm text-ink-muted">
          {t('signup.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-primary-ink hover:text-primary-ink-hover">
            {t('signup.signIn')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default SignupPage;
