import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleButton from '../components/auth/GoogleButton';
import { Button, Input, PasswordInput } from '../components/ui';

const SignupPage: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <label htmlFor="fullname-input" className="mb-2 block text-sm font-semibold text-ink">
            Full Name
          </label>
          <Input
            id="fullname-input"
            type="text"
            placeholder="e.g. Priya Mishra"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="email-input" className="mb-2 block text-sm font-semibold text-ink">
            Email Address
          </label>
          <Input
            id="email-input"
            type="email"
            placeholder="e.g. priya.mishra@department.gov"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="password-input" className="mb-2 block text-sm font-semibold text-ink">
            Password
          </label>
          <PasswordInput
            id="password-input"
            placeholder="Min. 6 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
          {loading ? 'Creating account...' : 'Create Account'}
        </Button>

        <div className="my-1 flex items-center gap-3" aria-hidden>
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wider text-ink-faint">Or sign up with</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <GoogleButton />

        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-primary hover:text-primary-hover">
            Sign In
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default SignupPage;
