import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { Sun, Moon, LogOut } from 'lucide-react';
import LanguageSwitcher from '../LanguageSwitcher';
import { Button } from '../ui';
import Logo from '../brand/Logo';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
  onSignOut?: () => void;
}

/**
 * Every sign-in, sign-up and verification screen: one column, the form in a
 * plain panel, nothing to read before the first field. Health workers open
 * this on a phone in the field; it has to load fast and get out of the way.
 */
const AuthLayout: React.FC<AuthLayoutProps> = ({ children, title, subtitle, onSignOut }) => {
  const { darkMode, toggleDarkMode } = useTheme();
  const { t } = useTranslation(['auth', 'common']);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-ink">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="min-w-0 rounded-md">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            {onSignOut && (
              <Button variant="ghost" size="sm" onClick={onSignOut} iconLeft={<LogOut className="size-4" />}>
                <span className="max-sm:hidden">{t('auth:signOut.notYou')}</span>
              </Button>
            )}
            <LanguageSwitcher variant="compact" />
            <button
              type="button"
              onClick={toggleDarkMode}
              title={darkMode ? t('common:theme.light') : t('common:theme.dark')}
              aria-label={darkMode ? t('common:theme.light') : t('common:theme.dark')}
              className="flex size-10 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              {darkMode ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md">
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
          <p className="mt-1 mb-5 text-sm text-ink-muted">{subtitle}</p>

          <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">{children}</div>

          <p className="mt-5 text-sm text-ink-muted">{t('auth:panel.body')}</p>

          {/* Every sign-in screen carries the route to the privacy notice and
              to a rights request. The DPDP Act's grievance route has to be
              reachable by someone who cannot get past this page — which is
              often exactly who needs it. */}
          <p className="mt-3 text-sm">
            <Link to="/privacy" className="text-primary-ink hover:underline">
              {t('auth:privacyLink')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default AuthLayout;
