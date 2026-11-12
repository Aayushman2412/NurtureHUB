import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/ui';
import Logo from '../components/brand/Logo';
import LanguageSwitcher from '../components/LanguageSwitcher';
import InstallAppButton from '../components/layout/InstallAppButton';

const USERS = ['worker', 'monitor', 'district'] as const;

/**
 * The public front door. It says what the system is and who it is for, then
 * gets out of the way: almost everyone arriving here wants to sign in.
 */
const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation(['landing', 'common']);
  const { isAuthenticated, isVerified, isProfileComplete } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();

  const openApp = () => {
    if (!isVerified) navigate('/verify');
    else if (!isProfileComplete) navigate('/register');
    else navigate('/dashboard');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-ink">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Logo context={<span className="hidden sm:inline">{t('landing:nav.badge')}</span>} />
          <div className="flex items-center gap-2">
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

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <section className="max-w-2xl">
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{t('common:brand.name')}</h1>
          <p className="mt-3 text-base text-ink-muted sm:text-lg">{t('landing:intro.lead')}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {isAuthenticated ? (
              <Button size="lg" onClick={openApp}>{t('landing:nav.goToApp')}</Button>
            ) : (
              <>
                <Button size="lg" onClick={() => navigate('/login')}>{t('landing:nav.signIn')}</Button>
                <Button size="lg" variant="outline" onClick={() => navigate('/signup')}>
                  {t('landing:intro.register')}
                </Button>
              </>
            )}
            <InstallAppButton className="sm:ml-1" />
          </div>
        </section>

        <section aria-labelledby="users-h" className="mt-12">
          <h2 id="users-h" className="text-base font-semibold text-ink">{t('landing:uses.title')}</h2>
          <dl className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {USERS.map(key => (
              <div key={key} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[12rem_1fr] sm:gap-6">
                <dt className="text-sm font-semibold text-ink">{t(`landing:uses.${key}.title`)}</dt>
                <dd className="text-sm text-ink-muted">{t(`landing:uses.${key}.body`)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-sm text-ink-muted sm:px-6">
          <span>{t('landing:footer.note')}</span>
          <Link to="/privacy" className="text-primary-ink hover:underline">{t('landing:footer.privacy')}</Link>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
