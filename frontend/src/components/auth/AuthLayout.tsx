import React, { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Sun, Moon, Globe, ChevronDown, BookOpen, Award, Sprout } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Dropdown } from '../ui';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}

const languages = [
  { name: 'English', native: 'English' },
  { name: 'Hindi', native: 'हिंदी' },
  { name: 'Tamil', native: 'தமிழ்' },
  { name: 'Telugu', native: 'తెలుగు' },
  { name: 'Marathi', native: 'मराठी' },
  { name: 'Bengali', native: 'বাংলা' },
  { name: 'Kannada', native: 'ಕನ್ನಡ' },
];

const AuthLayout: React.FC<AuthLayoutProps> = ({ children, title, subtitle }) => {
  const { darkMode, toggleDarkMode } = useTheme();
  const [selectedLang, setSelectedLang] = useState('English');

  return (
    <div className="relative h-screen overflow-hidden bg-background text-ink">
      {/* Theme toggle, absolute top-right */}
      <button
        onClick={toggleDarkMode}
        title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        className="absolute top-5 right-5 z-10 flex size-10 items-center justify-center rounded-full
                   bg-surface border border-border shadow-md text-ink-muted hover:text-ink
                   transition-colors cursor-pointer"
      >
        {darkMode ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
      </button>

      <div className="flex h-full">
        {/* Left: form panel (scrolls independently) */}
        <div className="scrollbar-slim flex h-full w-full flex-col overflow-y-auto px-6 py-6 sm:px-12 lg:w-1/2 lg:px-16">
          {/* Language selector */}
          <div className="mb-6">
            <Dropdown
              trigger={open => (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface
                             px-4 py-2 text-sm font-semibold text-ink-muted hover:text-ink
                             transition-colors cursor-pointer"
                >
                  <Globe className="size-4" />
                  {selectedLang}
                  <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
              )}
              items={languages.map(lang => ({
                key: lang.name,
                selected: lang.name === selectedLang,
                label: (
                  <span className="flex w-full items-center justify-between gap-4">
                    {lang.name}
                    <span className="text-xs opacity-60">{lang.native}</span>
                  </span>
                ),
                onSelect: () => setSelectedLang(lang.name),
              }))}
            />
          </div>

          {/* Centered form content */}
          <div className="my-auto w-full max-w-md mx-auto lg:mx-0">
            <div className="mb-8 flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-coral-400 to-coral-600 shadow-(--shadow-glow)">
                <Sprout className="size-7 text-white" />
              </span>
              <div>
                <span className="block font-display text-2xl font-extrabold">NurtureHUB</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                  ICDS Training Platform
                </span>
              </div>
            </div>

            <h2 className="font-display text-3xl font-extrabold">{title}</h2>
            <p className="mt-2 mb-8 text-ink-muted">{subtitle}</p>

            {children}
          </div>

          {/* Footer-lite */}
          <div className="mt-6 flex w-full items-center justify-between text-[13px] text-ink-faint">
            <p>© 2026 NurtureHUB. All rights reserved.</p>
            <div className="flex gap-4">
              <Link to="#" className="hover:text-ink-muted transition-colors">Privacy Policy</Link>
              <Link to="#" className="hover:text-ink-muted transition-colors">Terms</Link>
            </div>
          </div>
        </div>

        {/* Right: brand panel */}
        <div className="relative hidden w-1/2 items-center justify-center overflow-hidden
                        bg-gradient-to-br from-sage-100 via-cream-100 to-coral-100
                        dark:from-sage-950 dark:via-(--background) dark:to-coral-950/40 lg:flex">
          {/* Decorative blobs */}
          <div className="absolute -top-24 -right-24 size-96 rounded-full bg-coral-200/40 blur-3xl dark:bg-coral-500/10" aria-hidden />
          <div className="absolute -bottom-32 -left-24 size-96 rounded-full bg-sage-300/40 blur-3xl dark:bg-sage-500/10" aria-hidden />

          <div className="relative z-1 mx-auto w-full max-w-md px-8 text-center">
            <div className="mb-8 flex flex-col items-center">
              <div className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-surface shadow-(--shadow-card-hover)">
                <Sprout className="size-11 text-sage-600 dark:text-sage-300" />
              </div>
              <h3 className="font-display text-3xl font-extrabold leading-tight">
                Nurturing Skills, Elevating Communities
              </h3>
              <div className="mt-4 h-1 w-16 rounded-full bg-coral-500" aria-hidden />
            </div>

            <p className="mb-8 text-ink-muted">
              Access standardized training videos, complete knowledge-check assessments, unlock
              specialized badges, and monitor your personal growth journey.
            </p>

            <div className="grid grid-cols-2 gap-4 text-left">
              <div className="rounded-2xl border border-border bg-surface/70 p-5 backdrop-blur-sm">
                <BookOpen className="mb-3 size-6 text-coral-600 dark:text-coral-300" />
                <h4 className="font-display text-sm font-bold">Training Modules</h4>
                <p className="mt-1 text-xs text-ink-muted">
                  Interactive video tutorials designed specifically for ICDS &amp; Anganwadi workflows.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-surface/70 p-5 backdrop-blur-sm">
                <Award className="mb-3 size-6 text-coral-600 dark:text-coral-300" />
                <h4 className="font-display text-sm font-bold">Assessments &amp; Badges</h4>
                <p className="mt-1 text-xs text-ink-muted">
                  Structured knowledge checks to verify learning and earn official milestone badges.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
