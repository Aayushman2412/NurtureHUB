import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import OTPInput from '../components/auth/OTPInput';
import { Button, Input, PasswordInput } from '../components/ui';

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const { forgotPassword, resetPassword } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      showToast('Please enter your email address', 'warning');
      return;
    }

    setLoading(true);
    showToast('Sending reset code...', 'info');

    try {
      await forgotPassword(email);
      showToast('If registered, a 6-digit reset code has been sent to your email.', 'success');
      setSubmitted(true);
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to request reset link', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !newPassword) {
      showToast('Please enter the verification code and new password', 'warning');
      return;
    }

    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters long', 'warning');
      return;
    }

    setLoading(true);
    showToast('Resetting password...', 'info');

    try {
      await resetPassword(email, code, newPassword);
      showToast('Password reset successfully! You can now sign in with your new password.', 'success');
      navigate('/login');
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Invalid or expired verification code', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Reset Password"
      subtitle={
        !submitted
          ? "Enter your email address and we'll send a 6-digit verification code."
          : 'Enter the verification code and choose a new password.'
      }
    >
      {!submitted ? (
        <form onSubmit={handleSendCode} className="flex flex-col gap-5">
          <div>
            <label htmlFor="email-input" className="mb-2 block text-sm font-semibold text-ink">
              Email Address
            </label>
            <Input
              id="email-input"
              type="email"
              placeholder="e.g. name@department.gov"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
            {loading ? 'Sending Code...' : 'Send Verification Code'}
          </Button>

          <p className="mt-2 text-center text-sm text-ink-muted">
            Back to{' '}
            <Link to="/login" className="font-semibold text-primary hover:text-primary-hover">
              Sign In
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="flex flex-col gap-5">
          <div className="text-center">
            <label className="mb-2 block text-sm font-semibold text-ink">6-Digit Verification Code</label>
            <OTPInput length={6} onComplete={otpCode => setCode(otpCode)} />
            <p className="-mt-2 text-xs text-ink-faint">
              Didn't receive it? Check your email or backend terminal output.
            </p>
          </div>

          <div>
            <label htmlFor="newpassword-input" className="mb-2 block text-sm font-semibold text-ink">
              New Password
            </label>
            <PasswordInput
              id="newpassword-input"
              placeholder="Min. 6 characters"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <Button type="submit" size="lg" fullWidth loading={loading} disabled={code.length < 6} className="mt-2">
            {loading ? 'Resetting...' : 'Reset Password'}
          </Button>

          <Button type="button" variant="outline" size="lg" fullWidth onClick={() => setSubmitted(false)}>
            Back
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
