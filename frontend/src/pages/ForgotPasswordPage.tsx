import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import OTPInput from '../components/auth/OTPInput';

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
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
          : "Enter the verification code and choose a new password."
      }
    >
      {!submitted ? (
        <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="email-input">Email Address</label>
            <input
              id="email-input"
              type="email"
              className="form-control"
              placeholder="e.g. name@department.gov"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '12px', fontWeight: 600, fontSize: '0.9375rem', marginTop: '8px' }}
          >
            {loading ? 'Sending Code...' : 'Send Verification Code'}
          </button>

          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Back to{' '}
            <Link to="/login" style={{ color: 'var(--primary-600)', fontWeight: 600, textDecoration: 'none' }}>
              Sign In
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="form-group" style={{ textAlign: 'center' }}>
            <label className="form-label">6-Digit Verification Code</label>
            <OTPInput length={6} onComplete={(otpCode) => setCode(otpCode)} />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '-8px' }}>
              Didn't receive it? Check your email or backend terminal output.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="newpassword-input">New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="newpassword-input"
                type={showPwd ? 'text' : 'password'}
                className="form-control"
                placeholder="Min. 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={loading}
                style={{ paddingRight: '48px' }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  color: 'var(--gray-500)',
                  padding: '4px'
                }}
              >
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || code.length < 6}
            style={{ width: '100%', padding: '12px', fontWeight: 600, fontSize: '0.9375rem', marginTop: '8px' }}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>

          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setSubmitted(false)}
            style={{ width: '100%', padding: '12px', cursor: 'pointer' }}
          >
            Back
          </button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
