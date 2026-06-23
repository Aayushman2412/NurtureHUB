import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

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

  return (
    <AuthLayout 
      title="Sign In" 
      subtitle="Access your customized training path and assessment reports."
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Email */}
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
              className="form-control"
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
                fontSize: '1.1rem',
                color: 'var(--gray-500)',
                padding: '4px'
              }}
            >
              {showPwd ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button 
          type="submit" 
          className="btn btn-primary" 
          disabled={loading}
          style={{ width: '100%', padding: '12px', fontWeight: 600, fontSize: '0.9375rem', marginTop: '8px' }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', margin: '12px 0' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0 16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Or continue with
          </span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
        </div>

        {/* Google OAuth Button */}
        <GoogleButton />

        {/* Link to Signup */}
        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '16px' }}>
          Don't have an account?{' '}
          <Link 
            to="/signup" 
            style={{ color: 'var(--primary-600)', fontWeight: 600, textDecoration: 'none' }}
          >
            Create account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
