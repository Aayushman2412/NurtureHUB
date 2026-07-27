import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { useNavigate } from 'react-router-dom';

interface GoogleButtonProps {
  onSuccessRedirect?: string;
}

/** How long to wait for the async GIS script (index.html) before giving up. */
const GIS_LOAD_TIMEOUT_MS = 10_000;

/**
 * Google sign-in.
 *
 * When VITE_GOOGLE_CLIENT_ID is set we render Google's OWN button via
 * `renderButton`, which opens the account-chooser popup. We deliberately do
 * not rely on One Tap (`prompt()`): it silently declines to display whenever
 * the browser has no Google session, third-party cookies are blocked, FedCM
 * errors, or the user has dismissed it a few times (Google then applies an
 * exponential cooldown lasting hours). In all those cases One Tap calls back
 * with a "not displayed" notification and the user sees nothing happen at all
 * — which is exactly how Google sign-in appeared broken in production.
 *
 * Without a client ID: dev builds keep the mock login; production says so
 * plainly rather than simulating a sign-in.
 */
const GoogleButton: React.FC<GoogleButtonProps> = ({ onSuccessRedirect = '/dashboard' }) => {
  const { t } = useTranslation('auth');
  const { googleLogin } = useAuth();
  const { darkMode } = useTheme();
  const { showToast, updateToast } = useToast();
  const navigate = useNavigate();

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  /** GIS script never loaded / threw — fall back to the plain button. */
  const [gisFailed, setGisFailed] = useState(false);

  /** Exchange the Google ID token for a session. */
  const handleCredential = useCallback(
    async (credential: string) => {
      const toastId = showToast(t('google.toast.initiating'), 'loading');
      try {
        const res = await googleLogin(credential);
        updateToast(toastId, t('google.toast.success'), 'success');
        navigate(res.is_profile_complete ? onSuccessRedirect : '/register');
      } catch (e: any) {
        updateToast(toastId, e.response?.data?.detail || t('google.toast.failed'), 'error');
      }
    },
    [googleLogin, navigate, onSuccessRedirect, showToast, updateToast, t],
  );

  // Read through a ref so re-initialising GIS isn't tied to callback identity.
  const credentialRef = useRef(handleCredential);
  credentialRef.current = handleCredential;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const startedAt = Date.now();

    const init = () => {
      if (cancelled) return;
      // @ts-ignore — GIS is loaded by a script tag in index.html
      const google = window.google;
      const container = containerRef.current;

      if (google?.accounts?.id && container) {
        try {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: (response: { credential?: string }) => {
              if (response?.credential) void credentialRef.current(response.credential);
            },
          });
          container.innerHTML = ''; // re-render cleanly on theme change
          google.accounts.id.renderButton(container, {
            type: 'standard',
            theme: darkMode ? 'filled_black' : 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            logo_alignment: 'center',
            // Google caps the rendered button at 400px.
            width: Math.min(Math.max(container.clientWidth || 320, 200), 400),
          });
        } catch (err) {
          console.error('Google Identity Services failed to initialise:', err);
          setGisFailed(true);
        }
        return;
      }

      if (Date.now() - startedAt > GIS_LOAD_TIMEOUT_MS) {
        setGisFailed(true); // script blocked (offline, ad-blocker, firewall)
        return;
      }
      setTimeout(init, 150);
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [clientId, darkMode]);

  /** No client ID (or GIS unavailable): dev mock, else an honest message.
   *  The mock is ONLY for local dev with no client ID configured — never when
   *  a real client ID exists (GIS just failed to load) and never in prod. */
  const handleFallbackClick = async () => {
    if (clientId || !import.meta.env.DEV) {
      showToast(t('google.toast.notConfigured'), 'warning');
      return;
    }

    const toastId = showToast(t('google.toast.simulating'), 'loading');
    const testEmail = 'ayushman2412@gmail.com';
    const mockToken = 'mock_google_token_ayushman2412';

    setTimeout(async () => {
      try {
        const response = await googleLogin(mockToken);
        updateToast(toastId, t('google.toast.signedInAs', { email: testEmail }), 'success');
        navigate(response.is_profile_complete ? onSuccessRedirect : '/register');
      } catch (err: any) {
        updateToast(toastId, err.response?.data?.detail || t('google.toast.simFailed'), 'error');
      }
    }, 1000);
  };

  // Configured and healthy → Google's own button (reliable popup flow).
  if (clientId && !gisFailed) {
    return <div ref={containerRef} className="flex w-full justify-center" />;
  }

  return (
    <button
      type="button"
      onClick={handleFallbackClick}
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
      <span>{t('google.continue')}</span>
    </button>
  );
};

export default GoogleButton;
