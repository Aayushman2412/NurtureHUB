import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';

const SignupPage: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !password) {
      showToast('Please fill in all fields', 'warning');
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters long', 'warning');
      return;
    }

    setLoading(true);
    showToast('Creating account...', 'info');

    try {
      await register(email, password, fullName);
      showToast('Account created! A verification code has been sent to your email.', 'success');
      navigate('/verify');
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Registration failed. Email might already exist.';
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Register now to start your standardized skills development path."
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Full Name */}
        <div className="form-group">
          <label className="form-label" htmlFor="fullname-input">Full Name</label>
          <input
            id="fullname-input"
            type="text"
            className="form-control"
            placeholder="e.g. Priya Mishra"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        {/* Email */}
        <div className="form-group">
          <label className="form-label" htmlFor="email-input">Email Address</label>
          <input
            id="email-input"
            type="email"
            className="form-control"
            placeholder="e.g. priya.mishra@department.gov"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        {/* Password */}
        <div className="form-group">
          <label className="form-label" htmlFor="password-input">Password</label>
          <div style={{ position: 'relative' }}>
            <input
              id="password-input"
              type={showPwd ? 'text' : 'password'}
              className="form-control"
              placeholder="Min. 6 characters"
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
          {loading ? 'Creating account...' : 'Create Account'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', margin: '12px 0' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0 16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Or sign up with
          </span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
        </div>

        {/* Google OAuth Button */}
        <GoogleButton />

        {/* Link to Login */}
        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '16px' }}>
          Already have an account?{' '}
          <Link
            to="/login"
            style={{ color: 'var(--primary-600)', fontWeight: 600, textDecoration: 'none' }}
          >
            Sign In
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default SignupPage;
