import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useNavigate } from 'react-router-dom';

interface GoogleButtonProps {
  onSuccessRedirect?: string;
}

const GoogleButton: React.FC<GoogleButtonProps> = ({ onSuccessRedirect = '/dashboard' }) => {
  const { googleLogin } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleGoogleClick = async () => {
    // Check if Client ID is configured
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    
    if (clientId) {
      // In a real browser environment, we'd trigger the Google Identity Services flow.
      // Below is the integration hook.
      showToast('Initiating Google sign-in...', 'info');
      try {
        // @ts-ignore
        const google = window.google;
        if (google && google.accounts && google.accounts.id) {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: async (response: any) => {
              try {
                const res = await googleLogin(response.credential);
                showToast('Signed in with Google successfully!', 'success');
                if (res.is_profile_complete) {
                  navigate(onSuccessRedirect);
                } else {
                  navigate('/register');
                }
              } catch (e: any) {
                showToast(e.response?.data?.detail || 'Google sign-in failed', 'error');
              }
            }
          });
          google.accounts.id.prompt();
          return;
        }
      } catch (err) {
        console.error('GIS initialization failed:', err);
      }
    }

    // Fallback Mock Google Login flow if VITE_GOOGLE_CLIENT_ID is not configured
    showToast('Simulating Google Sign-In for development...', 'info');
    
    const testEmail = "ayushman2412@gmail.com";
    const formattedEmail = "ayushman2412";
    const mockToken = `mock_google_token_${formattedEmail}`;
    
    setTimeout(async () => {
      try {
        const response = await googleLogin(mockToken);
        showToast(`Signed in as Google account: ${testEmail}`, 'success');
        
        if (response.is_profile_complete) {
          navigate(onSuccessRedirect);
        } else {
          navigate('/register');
        }
      } catch (err: any) {
        showToast(err.response?.data?.detail || 'Google sign-in simulation failed', 'error');
      }
    }, 1000);
  };

  return (
    <button
      type="button"
      onClick={handleGoogleClick}
      className="inline-flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg
                 border border-border-strong/60 bg-surface px-6 py-3 font-display text-base
                 font-semibold text-ink transition-all duration-150 hover:border-border-strong
                 hover:bg-surface-sunken/50 active:translate-y-px"
    >
      {/* SVG Google Logo */}
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7v2.24h2.9c1.69-1.55 2.69-3.84 2.69-6.57z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.23l-2.9-2.24c-.8.54-1.84.87-3.06.87-2.35 0-4.35-1.59-5.06-3.73H.95v2.3C2.43 15.89 5.5 18 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.94 10.67A5.4 5.4 0 0 1 3.6 9c0-.58.1-1.15.28-1.67V5.03H.95A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.95 4.03l2.99-2.36z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47.89 11.43 0 9 0 5.5 0 2.43 2.11.95 5.03l2.99 2.36c.71-2.14 2.71-3.73 5.06-3.73z"
        />
      </svg>
      <span>Continue with Google</span>
    </button>
  );
};

export default GoogleButton;
