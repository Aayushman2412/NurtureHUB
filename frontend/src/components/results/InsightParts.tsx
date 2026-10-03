/**
 * Building blocks shared by every Results → Insights page (overview, one page
 * per test, tests compared). Components only — the numbers live in
 * lib/resultsInsights.ts, the charts in InsightCharts.tsx.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Lightbulb, ThumbsUp, TriangleAlert, X } from 'lucide-react';
import { Button, Card } from '../ui';
import { cn } from '../../utils/cn';
import { fmtPct, toneColor, type DimensionKey, type Finding } from '../../lib/resultsInsights';
import type { DimensionFilters } from './types';

export const Section: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, actions, className, children }) => (
  <Card className={cn('p-5 sm:p-6', className)}>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300 [&>svg]:size-5">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
    {children}
  </Card>
);

export const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'border-primary bg-primary text-primary-fg'
        : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
    )}
  >
    {children}
  </button>
);

/** "Split by: [Cadre] [Block] …" */
export const ChipRow: React.FC<{
  label: string;
  items: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}> = ({ label, items, value, onChange }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="mr-1 text-sm font-semibold text-ink-muted">{label}</span>
    {items.map(i => <Chip key={i.key} active={i.key === value} onClick={() => onChange(i.key)}>{i.label}</Chip>)}
  </div>
);

/** Active multi-dimension filter pills shown right in the selection area */
export const ActiveFilterBar: React.FC<{
  filters: DimensionFilters;
  groupLabel: (group: string, dim?: DimensionKey) => string;
  onClear: (dim?: DimensionKey) => void;
  filteredCount: number;
  totalCount: number;
  className?: string;
}> = ({ filters, groupLabel, onClear, filteredCount, totalCount, className }) => {
  const { t } = useTranslation('resultsInsights');
  const entries = Object.entries(filters) as [DimensionKey, string][];
  if (entries.length === 0) return null;

  return (
    <div className={cn(
      'mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/90 px-3.5 py-2.5 text-xs sm:text-sm dark:border-amber-500/40 dark:bg-amber-500/10',
      className,
    )}>
      <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-300">
        <Filter className="size-3.5 text-amber-700 dark:text-amber-400" />
        <span>{t('focus.filterActive')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map(([d, val]) => (
          <span
            key={d}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/80 bg-surface px-2.5 py-1 text-xs font-semibold text-ink shadow-xs dark:border-amber-500/40 dark:bg-surface"
          >
            <span className="font-normal text-ink-muted">{t(`dimSingular.${d}`)}:</span>
            <span>{groupLabel(val, d)}</span>
            <button
              type="button"
              onClick={() => onClear(d)}
              className="ml-0.5 rounded-full p-0.5 text-ink-muted transition-colors hover:bg-amber-100 hover:text-ink dark:hover:bg-amber-500/20"
              title={t('focus.clearDim', { dim: t(`dimSingular.${d}`) })}
              aria-label={t('focus.clearDim', { dim: t(`dimSingular.${d}`) })}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <span className="text-xs text-ink-muted">
        ({t('focus.learnersCount', { n: filteredCount, total: totalCount })})
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-7 px-2 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
        onClick={() => onClear()}
      >
        <X className="mr-1 size-3" />
        {t('focus.clearAll')}
      </Button>
    </div>
  );
};

/** A headline number: the picture on top, the words underneath. */
export const Kpi: React.FC<{ visual: React.ReactNode; label: string; value: React.ReactNode; note?: string }> = ({ visual, label, value, note }) => (
  <Card className="flex flex-col items-center gap-3 p-5 text-center">
    {visual}
    <div className="min-w-0">
      <div className="text-sm font-semibold text-ink">{label}</div>
      <div className="text-sm text-ink-muted">{value}</div>
      {note && <div className="text-xs text-ink-faint">{note}</div>}
    </div>
  </Card>
);

/** Literal class names (Tailwind cannot see computed ones): tiles per row. */
const KPI_COLS: Record<number, string> = {
  3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6',
};

export const KpiRow: React.FC<{ count: number; children: React.ReactNode }> = ({ count, children }) => (
  <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3', KPI_COLS[Math.max(3, Math.min(count, 6))])}>
    {children}
  </div>
);

/** A big plain number where a ring would say nothing (a count, a change). */
export const BigNumber: React.FC<{ value: React.ReactNode; tone?: 'good' | 'bad' | 'neutral'; icon?: React.ReactNode }> = ({ value, tone = 'neutral', icon }) => (
  <span className={cn(
    'flex size-[76px] items-center justify-center rounded-full font-display text-2xl font-extrabold',
    tone === 'good' && 'bg-success-50 text-success-600 dark:bg-success-500/15',
    tone === 'bad' && 'bg-error-50 text-error-600 dark:bg-error-500/15',
    tone === 'neutral' && 'bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300',
  )}>
    {icon ?? value}
  </span>
);

/** A value in a scorecard cell, tinted by how good it is. */
export const ScoreCell: React.FC<{ value: number | null; sub?: string }> = ({ value, sub }) => {
  if (value === null) return <td className="px-3 py-2 text-center text-ink-faint">—</td>;
  const c = toneColor(value);
  return (
    <td className="px-2 py-1.5 text-center">
      <span
        className="inline-block min-w-14 rounded-md px-2 py-1 text-sm font-bold tabular-nums"
        style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}
      >
        {fmtPct(value)}
      </span>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </td>
  );
};

export const InlineBar: React.FC<{ value: number; note?: string }> = ({ value, note }) => (
  <div className="flex items-center gap-2.5">
    <span className="relative h-3.5 flex-1 rounded-full bg-surface-sunken">
      <span className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: toneColor(value), transition: 'width 500ms ease' }} />
    </span>
    <span className="w-11 text-right text-sm font-bold tabular-nums text-ink">{fmtPct(value)}</span>
    {note && <span className="hidden text-xs text-ink-muted md:inline">{note}</span>}
  </div>
);

/** Green / amber / red key for the scorecards. */
export const ToneLegend: React.FC<{ good: string; ok: string; low: string }> = ({ good, ok, low }) => (
  <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
    <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-success-500" />{good}</span>
    <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500" />{ok}</span>
    <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-error-500" />{low}</span>
  </div>
);

export const FindingList: React.FC<{ findings: Finding[]; text: (f: Finding) => string; empty: string }> = ({ findings, text, empty }) => (
  findings.length === 0 ? (
    <p className="text-sm text-ink-muted">{empty}</p>
  ) : (
    <ul className="space-y-3">
      {findings.map((f, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&>svg]:size-4',
            f.tone === 'good' && 'bg-success-50 text-success-600 dark:bg-success-500/15',
            f.tone === 'watch' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
            f.tone === 'info' && 'bg-surface-sunken text-ink-muted',
          )}>
            {f.tone === 'good' ? <ThumbsUp /> : f.tone === 'watch' ? <TriangleAlert /> : <Lightbulb />}
          </span>
          <span className="text-sm leading-relaxed text-ink">{text(f)}</span>
        </li>
      ))}
    </ul>
  )
);

export type CountValue = number | 'all';
export type RankDir = 'top' | 'bottom';

/**
 * "Show [Top|Bottom] [ 10 ] — 10 · 20 · 50 · 100 · All": how many learners a
 * ranked list shows, from which end. The box takes any number; the chips are
 * the usual picks.
 */
export const CountPicker: React.FC<{
  n: CountValue;
  onN: (n: CountValue) => void;
  dir?: RankDir;
  onDir?: (d: RankDir) => void;
  presets?: number[];
}> = ({ n, onN, dir, onDir, presets = [10, 20, 50, 100] }) => {
  const { t } = useTranslation('resultsInsights');
  const [draft, setDraft] = React.useState(n === 'all' ? '' : String(n));
  React.useEffect(() => { setDraft(n === 'all' ? '' : String(n)); }, [n]);
  const commit = (raw: string) => {
    const v = Math.floor(Number(raw));
    if (raw.trim() && Number.isFinite(v) && v >= 1) onN(Math.min(v, 100000));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {onDir && dir && (
        <div role="group" aria-label={t('pick.which')} className="inline-flex rounded-lg border border-border bg-surface-sunken p-0.5">
          {(['top', 'bottom'] as RankDir[]).map(d => (
            <button
              key={d}
              type="button"
              aria-pressed={dir === d}
              onClick={() => onDir(d)}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1 text-sm font-semibold transition-colors',
                dir === d ? 'bg-surface text-primary-ink shadow-(--shadow-card)' : 'text-ink-muted hover:text-ink',
              )}
            >
              {t(`pick.${d}`)}
            </button>
          ))}
        </div>
      )}
      <label className="inline-flex items-center gap-1.5 font-semibold text-ink-muted">
        {t('pick.show')}
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          placeholder={t('pick.all')}
          onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setDraft(raw); commit(raw); }}
          onBlur={() => setDraft(n === 'all' ? '' : String(n))}
          className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-center text-sm font-bold text-ink focus:border-primary focus:outline-none"
          aria-label={t('pick.howMany')}
        />
      </label>
      {presets.map(p => <Chip key={p} active={n === p} onClick={() => onN(p)}>{p}</Chip>)}
      <Chip active={n === 'all'} onClick={() => onN('all')}>{t('pick.all')}</Chip>
    </div>
  );
};

/** 1st gold, 2nd–3rd light gold, the rest grey. */
export const RankBadge: React.FC<{ rank: number }> = ({ rank }) => (
  <span className={cn(
    'flex size-7 items-center justify-center rounded-full text-xs font-bold',
    rank === 1 ? 'bg-amber-500 text-white'
      : rank <= 3 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-500'
        : 'bg-surface-sunken text-ink-muted',
  )}>{rank}</span>
);

/** The page switcher under the Insights tab: Overview · each test · compared. */
export const SubNav: React.FC<{
  items: { key: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (key: string) => void;
  label: string;
}> = ({ items, value, onChange, label }) => (
  <nav aria-label={label} className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-surface-sunken p-1.5 sm:flex sm:flex-wrap sm:gap-2">
    {items.map(item => {
      const active = item.key === value;
      return (
        <button
          key={item.key}
          type="button"
          aria-current={active ? 'page' : undefined}
          onClick={() => onChange(item.key)}
          className={cn(
            'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-sm font-semibold transition-colors sm:whitespace-nowrap sm:px-4 [&>svg]:size-4 [&>svg]:shrink-0',
            active ? 'bg-surface text-primary-ink shadow-(--shadow-card)' : 'text-ink-muted hover:text-ink',
          )}
        >
          {item.icon}
          {item.label}
        </button>
      );
    })}
  </nav>
);
