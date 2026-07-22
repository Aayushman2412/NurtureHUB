import React from 'react';

export interface WelcomeBannerProps {
  /** Small uppercase eyebrow above the title (coral accent). */
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  /** Optional right-aligned content — actions, a chip, a progress ring, etc. */
  children?: React.ReactNode;
}

/**
 * Shared dashboard hero banner. A subtle, theme-aware surface card with a faint
 * coral wash and a coral eyebrow accent — used by BOTH the learner and admin
 * dashboards so the styling lives in exactly one place. Adapts to light/dark
 * automatically via theme tokens (no hardcoded colors).
 */
const WelcomeBanner: React.FC<WelcomeBannerProps> = ({ eyebrow, title, subtitle, children }) => (
  <div className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-coral-50/70 to-surface px-6 py-7 shadow-(--shadow-card) sm:px-8 sm:py-8 dark:from-coral-500/10 dark:to-surface">
    <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-coral-200/25 blur-3xl dark:bg-coral-500/10" aria-hidden />
    <div className="relative min-w-0">
      <span className="text-xs font-bold uppercase tracking-widest text-primary-ink">{eyebrow}</span>
      <h1 className="mt-1.5 mb-2 font-display text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
      <p className="max-w-xl text-[15px] text-ink-muted">{subtitle}</p>
    </div>
    {children && <div className="relative flex items-center gap-3">{children}</div>}
  </div>
);

export default WelcomeBanner;
