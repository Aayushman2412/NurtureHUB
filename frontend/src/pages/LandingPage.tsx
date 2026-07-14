import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import {
  Award, BookOpen, ChartLine, MapPin, ShieldCheck, Sprout, Users, ArrowRight, Sun, Moon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/ui';

const features = [
  {
    icon: BookOpen,
    key: 'training',
    tone: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  },
  {
    icon: Award,
    key: 'assessments',
    tone: 'text-coral-600 bg-coral-50 dark:text-coral-300 dark:bg-coral-500/15',
  },
  {
    icon: ChartLine,
    key: 'growth',
    tone: 'text-sage-700 bg-sage-50 dark:text-sage-300 dark:bg-sage-500/15',
  },
] as const;

const stats = [
  { icon: Users, key: 'frontline' },
  { icon: MapPin, key: 'district' },
  { icon: ShieldCheck, key: 'official' },
] as const;

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation(['landing', 'common']);
  const { isAuthenticated, isVerified, isProfileComplete } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();

  const handleCTA = () => {
    if (isAuthenticated) {
      if (!isVerified) navigate('/verify');
      else if (!isProfileComplete) navigate('/register');
      else navigate('/dashboard');
    } else {
      navigate('/signup');
    }
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      {/* ── Nav ─────────────────────────────────────────── */}
      <nav className="flex items-center justify-between border-b border-border bg-surface/80 px-[max(24px,6%)] py-4 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-coral-400 to-coral-600">
            <Sprout className="size-6 text-white" />
          </span>
          <div>
            <span className="block font-display text-lg font-extrabold leading-tight">{t('common:brand.name')}</span>
            <span className="hidden text-[10px] font-bold uppercase tracking-widest text-primary sm:block">
              {t('landing:nav.badge')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleDarkMode}
            title={darkMode ? t('common:theme.light') : t('common:theme.dark')}
            className="flex size-10 items-center justify-center rounded-full border border-border bg-surface
                       text-ink-muted transition-colors hover:text-ink cursor-pointer"
          >
            {darkMode ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </button>
          {isAuthenticated ? (
            <Button onClick={handleCTA} iconRight={<ArrowRight className="size-4" />}>
              {t('landing:nav.goToApp')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => navigate('/login')} className="max-sm:hidden">
                {t('landing:nav.signIn')}
              </Button>
              <Button onClick={() => navigate('/signup')}>{t('landing:nav.register')}</Button>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 py-14 text-center sm:py-20 lg:py-28">
        <div className="absolute -top-40 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-coral-200/30 blur-3xl dark:bg-coral-500/10" aria-hidden />
        <div className="absolute -bottom-56 right-[10%] size-96 rounded-full bg-sage-300/30 blur-3xl dark:bg-sage-500/10" aria-hidden />

        <div className="relative mx-auto max-w-3xl">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-ink-muted">
            <Sprout className="size-3.5 text-sage-600 dark:text-sage-300" />
            {t('landing:hero.eyebrow')}
          </span>
          <h1 className="font-display text-4xl font-extrabold leading-tight sm:text-6xl">
            <Trans t={t} i18nKey="landing:hero.title" components={{ hl: <span className="text-primary" /> }} />
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-ink-muted">
            {t('landing:hero.subtitle')}
          </p>
          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Button size="lg" onClick={handleCTA} iconRight={<ArrowRight className="size-4.5" />} className="w-full sm:w-auto">
              {isAuthenticated ? t('landing:hero.ctaContinue') : t('landing:hero.ctaStart')}
            </Button>
            {!isAuthenticated && (
              <Button size="lg" variant="outline" onClick={() => navigate('/login')} className="w-full sm:w-auto">
                {t('landing:hero.haveAccount')}
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-3">
          {features.map(f => (
            <div
              key={f.key}
              className="rounded-2xl border border-border bg-surface p-7 shadow-(--shadow-card)
                         transition-all duration-200 hover:-translate-y-1 hover:shadow-(--shadow-card-hover)"
            >
              <span className={`mb-5 inline-flex size-12 items-center justify-center rounded-xl ${f.tone}`}>
                <f.icon className="size-6" />
              </span>
              <h3 className="font-display text-lg font-bold">{t(`landing:features.${f.key}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{t(`landing:features.${f.key}.body`)}</p>
            </div>
          ))}
        </div>

        {/* Trust strip */}
        <div className="mt-6 grid gap-6 rounded-2xl border border-border bg-gradient-to-br from-sage-50 to-cream-100 p-8 dark:from-sage-950/40 dark:to-surface md:grid-cols-3">
          {stats.map(s => (
            <div key={s.key} className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-coral-600 shadow-sm dark:text-coral-300">
                <s.icon className="size-5" />
              </span>
              <div>
                <div className="font-display font-bold">{t(`landing:stats.${s.key}.value`)}</div>
                <div className="mt-0.5 text-sm text-ink-muted">{t(`landing:stats.${s.key}.label`)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-border bg-surface px-[max(24px,6%)] py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-ink-faint">
          <div className="flex items-center gap-2">
            <Sprout className="size-4 text-sage-600 dark:text-sage-300" />
            <span>{t('common:footer.rights')}</span>
          </div>
          <div className="flex gap-6">
            <Link to="#" className="transition-colors hover:text-ink-muted">{t('common:footer.privacy')}</Link>
            <Link to="#" className="transition-colors hover:text-ink-muted">{t('common:footer.terms')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
