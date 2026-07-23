import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import OTPInput from '../components/auth/OTPInput';
import { Button } from '../components/ui';

const OTPPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [loading, setLoading] = useState(false);

  const { verifyOtp, forgotPassword } = useAuth();
  const { showToast, updateToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const savedEmail = localStorage.getItem('nh_user_email') || '';
    if (!savedEmail) {
      showToast(t('otp.toast.noSession'), 'warning');
      navigate('/login');
      return;
    }
    setEmail(savedEmail);
  }, [navigate]);

  const handleVerify = async (otpCode: string) => {
    setLoading(true);
    const toastId = showToast(t('otp.toast.verifying'), 'loading');

    try {
      const response = await verifyOtp(email, otpCode);
      updateToast(toastId, t('otp.toast.verified'), 'success');

      if (response.is_profile_complete) {
        navigate('/dashboard');
      } else {
        navigate('/register');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || t('otp.toast.invalidCode');
      updateToast(toastId, errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    const toastId = showToast(t('otp.toast.requestingNew'), 'loading');
    try {
      await forgotPassword(email);
      updateToast(toastId, t('otp.toast.newCodeSent'), 'success');
    } catch {
      updateToast(toastId, t('otp.toast.resendFailed'), 'error');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title={t('otp.title')}
      subtitle={t('otp.subtitle', { email: email || t('otp.subtitleFallback') })}
    >
      <div className="flex flex-col gap-5">
        <div className="text-center">
          <label className="mb-3 block text-sm font-semibold text-ink">{t('otp.enterCode')}</label>
          <OTPInput length={6} onComplete={handleVerify} />
        </div>

        <div className="mt-3 text-center">
          <p className="text-sm text-ink-muted">
            {t('otp.notReceived')}{' '}
            <button
              onClick={handleResend}
              disabled={resending || loading}
              className="cursor-pointer p-1 text-sm font-semibold text-primary-ink hover:text-primary-ink-hover
                         disabled:opacity-50"
            >
              {resending ? t('otp.resending') : t('otp.resend')}
            </button>
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {t('otp.hint')}
          </p>
        </div>

        <Button variant="outline" size="lg" fullWidth onClick={() => navigate('/login')} className="mt-4">
          {t('otp.backToLogin')}
        </Button>
      </div>
    </AuthLayout>
  );
};

export default OTPPage;
