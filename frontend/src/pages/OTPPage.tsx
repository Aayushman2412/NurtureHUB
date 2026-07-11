import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import OTPInput from '../components/auth/OTPInput';
import { Button } from '../components/ui';

const OTPPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [loading, setLoading] = useState(false);

  const { verifyOtp, forgotPassword } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const savedEmail = localStorage.getItem('nh_user_email') || '';
    if (!savedEmail) {
      showToast('No active session found. Please register or sign in.', 'warning');
      navigate('/login');
      return;
    }
    setEmail(savedEmail);
  }, [navigate]);

  const handleVerify = async (otpCode: string) => {
    setLoading(true);
    showToast('Verifying code...', 'info');

    try {
      const response = await verifyOtp(email, otpCode);
      showToast('Account verified successfully!', 'success');

      if (response.is_profile_complete) {
        navigate('/dashboard');
      } else {
        navigate('/register');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Invalid or expired verification code';
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    showToast('Requesting new code...', 'info');
    try {
      await forgotPassword(email);
      showToast('New verification code sent to your email.', 'success');
    } catch {
      showToast('Failed to resend code. Please try again.', 'error');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Verify Account"
      subtitle={`We have sent a 6-digit verification code to ${email || 'your email address'}.`}
    >
      <div className="flex flex-col gap-5">
        <div className="text-center">
          <label className="mb-3 block text-sm font-semibold text-ink">Enter 6-digit Code</label>
          <OTPInput length={6} onComplete={handleVerify} />
        </div>

        <div className="mt-3 text-center">
          <p className="text-sm text-ink-muted">
            Didn't receive the email?{' '}
            <button
              onClick={handleResend}
              disabled={resending || loading}
              className="cursor-pointer p-1 text-sm font-semibold text-primary hover:text-primary-hover
                         disabled:opacity-50"
            >
              {resending ? 'Resending...' : 'Resend OTP Code'}
            </button>
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Note: You can check your email inbox or copy the code printed in the backend terminal logs.
          </p>
        </div>

        <Button variant="outline" size="lg" fullWidth onClick={() => navigate('/login')} className="mt-4">
          Back to Login
        </Button>
      </div>
    </AuthLayout>
  );
};

export default OTPPage;
