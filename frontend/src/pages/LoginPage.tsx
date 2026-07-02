import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import client from '../api/client';
import { Eye, EyeOff, Mail, ArrowLeft, Shield } from 'lucide-react';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

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

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmail || !adminPassword) {
      showToast('Please enter admin credentials', 'warning');
      return;
    }
    setAdminLoading(true);
    try {
      const res = await client.post('/api/admin/login', { email: adminEmail, password: adminPassword });
      localStorage.setItem('nh_admin', 'true');
      localStorage.setItem('nh_admin_token', res.data.access_token);
      localStorage.setItem('nh_admin_name', res.data.admin_name);
      showToast('Admin access granted!', 'success');
      navigate('/admin');
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Invalid admin credentials', 'error');
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin Login Form view
  if (showAdminForm) {
    return (
      <AuthLayout title="Admin Access" subtitle="Enter administrator credentials to access the management panel.">
        <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="admin-email">Admin Email</label>
            <input id="admin-email" type="email" className="auth-input-field" placeholder="admin@nurturehub.org" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} required disabled={adminLoading} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="admin-password">Password</label>
            <input id="admin-password" type="password" className="auth-input-field" placeholder="••••••••" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} required disabled={adminLoading} />
          </div>
          <button type="submit" className="auth-primary-btn" disabled={adminLoading} style={{ width: '100%', marginTop: '8px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
            <Shield size={18} />
            {adminLoading ? 'Authenticating...' : 'Login as Admin'}
          </button>
          <button type="button" onClick={() => setShowAdminForm(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '16px', alignSelf: 'center', fontWeight: 500 }}>
            <ArrowLeft size={16} /> Back to sign-in options
          </button>
        </form>
      </AuthLayout>
    );
  }

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

          {/* Divider for admin */}
          <div className="auth-divider">
            <div className="auth-divider-line" />
            <span className="auth-divider-text">admin access</span>
            <div className="auth-divider-line" />
          </div>

          {/* Admin Login Button */}
          <button
            type="button"
            onClick={() => setShowAdminForm(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              padding: '12px 20px', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.3)',
              background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
              color: '#6366f1', fontWeight: 600, fontSize: '0.9375rem', cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <Shield size={18} />
            Login as Admin
          </button>

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
