import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import client from '../api/client';
import { Mail, ArrowLeft, Shield } from 'lucide-react';
import { Button, Divider, FieldLabel, Input, PasswordInput } from '../components/ui';

const BackButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="mx-auto mt-2 inline-flex items-center gap-2 text-sm font-medium text-ink-muted
               hover:text-ink transition-colors cursor-pointer"
  >
    <ArrowLeft className="size-4" /> Back to sign-in options
  </button>
);

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  const { login } = useAuth();
  const { showToast, updateToast } = useToast();
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
    const toastId = showToast('Signing in...', 'loading');

    try {
      const response = await login(email, password);
      updateToast(toastId, 'Welcome back to NurtureHUB!', 'success');

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
      updateToast(toastId, errorMsg, 'error');
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
        <form onSubmit={handleAdminLogin} className="flex flex-col gap-5">
          <div>
            <FieldLabel htmlFor="admin-email">Admin Email</FieldLabel>
            <Input
              id="admin-email"
              type="email"
              placeholder="admin@nurturehub.org"
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              required
              disabled={adminLoading}
            />
          </div>
          <div>
            <FieldLabel htmlFor="admin-password">Password</FieldLabel>
            <PasswordInput
              id="admin-password"
              placeholder="••••••••"
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              required
              disabled={adminLoading}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="lg"
            fullWidth
            loading={adminLoading}
            iconLeft={<Shield className="size-4.5" />}
            className="mt-2"
          >
            {adminLoading ? 'Authenticating...' : 'Login as Admin'}
          </Button>
          <BackButton onClick={() => setShowAdminForm(false)} />
        </form>
      </AuthLayout>
    );
  }

  if (!showEmailForm) {
    return (
      <AuthLayout title="Welcome" subtitle="Please choose a method to access your training dashboard.">
        <div className="flex w-full flex-col gap-4">
          <Button
            type="button"
            size="lg"
            fullWidth
            iconLeft={<Mail className="size-4.5" />}
            onClick={() => setShowEmailForm(true)}
          >
            Sign in with Email
          </Button>

          <Divider label="or continue with" />

          <GoogleButton />

          <Divider label="admin access" />

          <Button
            type="button"
            variant="outline"
            size="lg"
            fullWidth
            iconLeft={<Shield className="size-4.5" />}
            onClick={() => setShowAdminForm(true)}
          >
            Login as Admin
          </Button>

          <p className="mt-6 text-center text-sm text-ink-muted">
            Don't have an account?{' '}
            <Link to="/signup" className="font-semibold text-primary hover:text-primary-hover">
              Create account
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign In" subtitle="Enter your email and password to access your training dashboard.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <FieldLabel htmlFor="email-input">Email Address</FieldLabel>
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

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="password-input" className="text-sm font-semibold text-ink">
              Password
            </label>
            <Link to="/forgot-password" className="text-[13px] font-semibold text-primary hover:text-primary-hover">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password-input"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>

        <BackButton onClick={() => setShowEmailForm(false)} />
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
