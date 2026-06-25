import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import { Eye, EyeOff, Mail, ArrowLeft } from 'lucide-react';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // If redirected because session expired, show toast
  React.useEffect(() => {
    if (searchParams.get('expired') === 'true') {
      showToast('Your session has expired. Please log in again.', 'warning');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      showToast('Please fill in all fields', 'warning');
      return;
    }

    setLoading(true);
    showToast('Signing in...', 'info');

    try {
      const response = await login(email, password);
      showToast('Welcome back to NurtureHUB!', 'success');
      
      // Handle page routing according to user auth states
      if (!response.is_verified) {
        navigate('/verify');
      } else if (!response.is_profile_complete) {
        navigate('/register');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Invalid email or password';
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!showEmailForm) {
    return (
      <AuthLayout 
        title="Welcome" 
        subtitle="Please choose a method to access your training dashboard."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
          {/* Sign in with Email Option */}
          <button 
            type="button" 
            onClick={() => setShowEmailForm(true)}
            className="auth-primary-btn"
          >
            <Mail size={18} />
            Sign in with Email
          </button>

          {/* Divider */}
          <div className="auth-divider">
            <div className="auth-divider-line" />
            <span className="auth-divider-text">or continue with</span>
            <div className="auth-divider-line" />
          </div>

          {/* Google Sign In Button */}
          <GoogleButton />

          {/* Create Account Link */}
          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '24px' }}>
            Don't have an account?{' '}
            <Link 
              to="/signup" 
              style={{ color: 'var(--primary-600)', fontWeight: 600, textDecoration: 'none' }}
            >
              Create account
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout 
      title="Sign In" 
      subtitle="Enter your email and password to access your training dashboard."
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Email */}
        <div className="form-group">
          <label className="form-label" htmlFor="email-input">Email Address</label>
          <input
            id="email-input"
            type="email"
            className="auth-input-field"
            placeholder="e.g. name@department.gov"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        {/* Password */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label className="form-label" htmlFor="password-input" style={{ marginBottom: 0 }}>Password</label>
            <Link 
              to="/forgot-password" 
              style={{ fontSize: '0.8125rem', color: 'var(--primary-600)', fontWeight: 600, textDecoration: 'none' }}
            >
              Forgot password?
            </Link>
          </div>
          <div style={{ position: 'relative' }}>
            <input
              id="password-input"
              type={showPwd ? 'text' : 'password'}
              className="auth-input-field"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
                color: 'var(--gray-500)',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button 
          type="submit" 
          className="auth-primary-btn" 
          disabled={loading}
          style={{ width: '100%', marginTop: '8px' }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        {/* Back Link */}
        <button
          type="button"
          onClick={() => setShowEmailForm(false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginTop: '16px',
            alignSelf: 'center',
            fontWeight: 500
          }}
        >
          <ArrowLeft size={16} />
          Back to sign-in options
        </button>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
