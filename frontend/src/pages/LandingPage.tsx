import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Award, BookOpen, ChartLine, MapPin, ShieldCheck, Sprout, Users, ArrowRight, Sun, Moon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/ui';

const features = [
  {
    icon: BookOpen,
    title: 'Structured Training',
    body: 'Standardized video modules built for ICDS & Anganwadi workflows — learn at your own pace, stage by stage.',
    tone: 'text-teal-600 bg-teal-50 dark:text-teal-300 dark:bg-teal-500/15',
  },
  {
    icon: Award,
    title: 'Assessments & Badges',
    body: 'Knowledge checks after every phase verify learning and earn official milestone badges for your profile.',
    tone: 'text-coral-600 bg-coral-50 dark:text-coral-300 dark:bg-coral-500/15',
  },
  {
    icon: ChartLine,
    title: 'Growth Tracking',
    body: 'A personal dashboard monitors progress, unlocks new stages, and keeps your development on course.',
    tone: 'text-sage-700 bg-sage-50 dark:text-sage-300 dark:bg-sage-500/15',
  },
];

const stats = [
  { icon: Users, value: 'Frontline first', label: 'Built for Anganwadi workers, helpers & supervisors' },
  { icon: MapPin, value: 'District-aware', label: 'Content and cohorts organized by your district' },
  { icon: ShieldCheck, value: 'Officially recognized', label: 'Progress and badges your department can trust' },
];

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
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
            <span className="block font-display text-lg font-extrabold leading-tight">NurtureHUB</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
              ICDS Professional Portal
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="flex size-10 items-center justify-center rounded-full border border-border bg-surface
                       text-ink-muted transition-colors hover:text-ink cursor-pointer"
          >
            {darkMode ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </button>
          {isAuthenticated ? (
            <Button onClick={handleCTA} iconRight={<ArrowRight className="size-4" />}>
              Go to App
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => navigate('/login')} className="max-sm:hidden">
                Sign In
              </Button>
              <Button onClick={() => navigate('/signup')}>Register</Button>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 py-20 text-center sm:py-28">
        <div className="absolute -top-40 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-coral-200/30 blur-3xl dark:bg-coral-500/10" aria-hidden />
        <div className="absolute -bottom-56 right-[10%] size-96 rounded-full bg-sage-300/30 blur-3xl dark:bg-sage-500/10" aria-hidden />

        <div className="relative mx-auto max-w-3xl">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-ink-muted">
            <Sprout className="size-3.5 text-sage-600 dark:text-sage-300" />
            Nurturing skills, elevating communities
          </span>
          <h1 className="font-display text-4xl font-extrabold leading-tight sm:text-6xl">
            Grow the skills that help
            <span className="text-primary"> children thrive</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-ink-muted">
            NurtureHUB is the training &amp; assessment home for ICDS professionals — standardized
            tutorials, fair assessments, and a clear record of your growth.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" onClick={handleCTA} iconRight={<ArrowRight className="size-4.5" />}>
              {isAuthenticated ? 'Continue your journey' : 'Start learning today'}
            </Button>
            {!isAuthenticated && (
              <Button size="lg" variant="outline" onClick={() => navigate('/login')}>
                I already have an account
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
              key={f.title}
              className="rounded-2xl border border-border bg-surface p-7 shadow-(--shadow-card)
                         transition-all duration-200 hover:-translate-y-1 hover:shadow-(--shadow-card-hover)"
            >
              <span className={`mb-5 inline-flex size-12 items-center justify-center rounded-xl ${f.tone}`}>
                <f.icon className="size-6" />
              </span>
              <h3 className="font-display text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.body}</p>
            </div>
          ))}
        </div>

        {/* Trust strip */}
        <div className="mt-6 grid gap-6 rounded-2xl border border-border bg-gradient-to-br from-sage-50 to-cream-100 p-8 dark:from-sage-950/40 dark:to-surface md:grid-cols-3">
          {stats.map(s => (
            <div key={s.value} className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-teal-600 shadow-sm dark:text-teal-300">
                <s.icon className="size-5" />
              </span>
              <div>
                <div className="font-display font-bold">{s.value}</div>
                <div className="mt-0.5 text-sm text-ink-muted">{s.label}</div>
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
            <span>© 2026 NurtureHUB. All rights reserved.</span>
          </div>
          <div className="flex gap-6">
            <Link to="#" className="transition-colors hover:text-ink-muted">Privacy Policy</Link>
            <Link to="#" className="transition-colors hover:text-ink-muted">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
