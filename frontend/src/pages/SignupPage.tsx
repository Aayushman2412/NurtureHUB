import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import PasswordRules from '../components/auth/PasswordRules';
import { usePasswordCheck } from '../hooks/usePasswordCheck';
import { Button, Divider, FieldLabel, Input, PasswordInput } from '../components/ui';

const SignupPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // The server's rules, ticked off as the person types (same numbers the
  // server enforces — see backend/app/security/passwords.py).
  const pw = usePasswordCheck(password, { email, fullName });

  const { register } = useAuth();
  const { showToast, updateToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !password) {
      showToast(t('signup.toast.fillAll'), 'warning');
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
      await register(email, password, fullName);
      updateToast(toastId, t('signup.toast.created'), 'success');
      navigate('/verify');
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || t('signup.toast.failed');
      updateToast(toastId, errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t('signup.title')} subtitle={t('signup.subtitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <FieldLabel htmlFor="fullname-input">{t('fields.fullName')}</FieldLabel>
          <Input
            id="fullname-input"
            type="text"
            placeholder={t('fields.fullNamePlaceholder')}
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <div>
          <FieldLabel htmlFor="email-input">{t('fields.email')}</FieldLabel>
          <Input
            id="email-input"
            type="email"
            placeholder={t('signup.emailPlaceholder')}
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <div>
          <FieldLabel htmlFor="password-input">{t('fields.password')}</FieldLabel>
          <PasswordInput
            id="password-input"
            placeholder={t('fields.passwordMin', { n: pw.policy.min_length })}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            disabled={loading}
            autoComplete="new-password"
            aria-describedby="password-rules"
          />
          <PasswordRules id="password-rules" className="mt-2.5" password={password} policy={pw.policy} results={pw.results} />
        </div>

        <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
          {loading ? t('signup.creating') : t('signup.submit')}
        </Button>

        <Divider label={t('signup.orSignUpWith')} className="my-1" />

        <GoogleButton />
        <p className="-mt-1 text-center text-xs leading-relaxed text-ink-muted">{t('signup.googleNote')}</p>

        <p className="mt-4 text-center text-sm text-ink-muted">
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
