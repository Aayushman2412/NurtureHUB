import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import OTPInput from '../components/auth/OTPInput';
import { Button, FieldLabel, Input, PasswordInput } from '../components/ui';

const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const { forgotPassword, resetPassword } = useAuth();
  const { showToast, updateToast } = useToast();
  const navigate = useNavigate();

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      showToast(t('forgot.toast.enterEmail'), 'warning');
      return;
    }

    setLoading(true);
    const toastId = showToast(t('forgot.toast.sendingCode'), 'loading');

    try {
      await forgotPassword(email);
      updateToast(toastId, t('forgot.toast.codeSent'), 'success');
      setSubmitted(true);
    } catch (err: any) {
      updateToast(toastId, err.response?.data?.detail || t('forgot.toast.requestFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !newPassword) {
      showToast(t('forgot.toast.enterCodeAndPassword'), 'warning');
      return;
    }

    if (newPassword.length < 6) {
      showToast(t('forgot.toast.passwordMin'), 'warning');
      return;
    }

    setLoading(true);
    const toastId = showToast(t('forgot.toast.resetting'), 'loading');

    try {
      await resetPassword(email, code, newPassword);
      updateToast(toastId, t('forgot.toast.resetSuccess'), 'success');
      navigate('/login');
    } catch (err: any) {
      updateToast(toastId, err.response?.data?.detail || t('forgot.toast.invalidCode'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t('forgot.title')}
      subtitle={submitted ? t('forgot.subtitleReset') : t('forgot.subtitleRequest')}
    >
      {!submitted ? (
        <form onSubmit={handleSendCode} className="flex flex-col gap-5">
          <div>
            <FieldLabel htmlFor="email-input">{t('fields.email')}</FieldLabel>
            <Input
              id="email-input"
              type="email"
              placeholder={t('fields.emailPlaceholder')}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
            {loading ? t('forgot.sendingCode') : t('forgot.sendCode')}
          </Button>

          <p className="mt-2 text-center text-sm text-ink-muted">
            <Link to="/login" className="font-semibold text-primary hover:text-primary-hover">
              {t('forgot.backToSignIn')}
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="flex flex-col gap-5">
          <div className="text-center">
            <label className="mb-2 block text-sm font-semibold text-ink">{t('forgot.codeLabel')}</label>
            <OTPInput length={6} onComplete={otpCode => setCode(otpCode)} />
            <p className="-mt-2 text-xs text-ink-faint">
              {t('forgot.notReceived')}
            </p>
          </div>

          <div>
            <FieldLabel htmlFor="newpassword-input">{t('fields.newPassword')}</FieldLabel>
            <PasswordInput
              id="newpassword-input"
              placeholder={t('fields.passwordMin')}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <Button type="submit" size="lg" fullWidth loading={loading} disabled={code.length < 6} className="mt-2">
            {loading ? t('forgot.resetting') : t('forgot.reset')}
          </Button>

          <Button type="button" variant="outline" size="lg" fullWidth onClick={() => setSubmitted(false)}>
            {t('forgot.back')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
