import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import OTPInput from '../components/auth/OTPInput';

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
    } catch (err: any) {
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="form-group" style={{ textAlign: 'center' }}>
          <label className="form-label" style={{ marginBottom: '12px' }}>Enter 6-digit Code</label>
          <OTPInput length={6} onComplete={handleVerify} />
        </div>

        {/* Action Buttons */}
        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Didn't receive the email?{' '}
            <button
              onClick={handleResend}
              disabled={resending || loading}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary-600)',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '4px',
                fontSize: '0.875rem'
              }}
            >
              {resending ? 'Resending...' : 'Resend OTP Code'}
            </button>
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Note: You can check your email inbox or copy the code printed in the backend terminal logs.
          </p>
        </div>

        <button
          className="auth-outline-btn"
          onClick={() => navigate('/login')}
          style={{ width: '100%', marginTop: '16px' }}
        >
          Back to Login
        </button>
      </div>
    </AuthLayout>
  );
};

export default OTPPage;
