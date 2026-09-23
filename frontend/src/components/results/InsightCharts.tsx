/**
 * Small, dependency-free charts for the Results insights.
 *
 * Built for readers who are not analysts: every chart carries its numbers in
 * plain text next to the shape (no hovering needed to read a value), colours
 * are consistent (green good, amber middling, red low), and anything clickable
 * says so on hover.
 */
import React from 'react';
import { cn } from '../../utils/cn';
import { fmtPct, toneColor } from '../../lib/resultsInsights';

// ── Ring: one percentage, big and round ─────────────────────────────────────

export const Ring: React.FC<{
  value: number;          // 0–100
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
}> = ({ value, size = 76, stroke = 8, color, children }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className="stroke-surface-sunken" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          stroke={color ?? toneColor(v)} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray 600ms ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-display text-lg font-extrabold text-ink">
        {children ?? fmtPct(v)}
      </div>
    </div>
  );
};

// ── Donut: who is in the picture ────────────────────────────────────────────

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export const Donut: React.FC<{
  slices: Slice[];
  size?: number;
  centerValue: React.ReactNode;
  centerLabel: React.ReactNode;
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  selectHint?: string;
}> = ({ slices, size = 188, centerValue, centerLabel, activeKey, onSelect, selectHint }) => {
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const gap = slices.filter(s => s.value > 0).length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" role="img" aria-label={String(centerLabel)}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-sunken" />
          {total > 0 && slices.map(s => {
            const len = (s.value / total) * c;
            const dim = activeKey && activeKey !== s.key;
            const el = (
              <circle
                key={s.key}
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={s.color} strokeWidth={activeKey === s.key ? stroke + 6 : stroke}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                opacity={dim ? 0.3 : 1}
                className={cn(onSelect && 'cursor-pointer')}
                style={{ transition: 'opacity 200ms, stroke-width 200ms' }}
                onClick={onSelect ? () => onSelect(s.key) : undefined}
              >
                <title>{`${s.label}: ${s.value} (${fmtPct((s.value / total) * 100)})${selectHint ? ` — ${selectHint}` : ''}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="font-display text-3xl font-extrabold leading-none text-ink">{centerValue}</div>
          <div className="mt-1 max-w-[7rem] text-xs text-ink-muted">{centerLabel}</div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5">
        {slices.map(s => (
          <li key={s.key}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              title={selectHint}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm transition-colors',
                onSelect && 'cursor-pointer hover:bg-surface-sunken',
                activeKey === s.key && 'bg-surface-sunken ring-1 ring-border-strong',
                activeKey && activeKey !== s.key && 'opacity-50',
              )}
            >
              <span className="size-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
              <span className="font-semibold tabular-nums text-ink">{s.value}</span>
              <span className="w-10 text-right text-xs tabular-nums text-ink-faint">
                {total > 0 ? fmtPct((s.value / total) * 100) : '—'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── BarList: compare groups on one measure ──────────────────────────────────

export interface BarRow {
  key: string;
  label: string;
  value: number;            // drawn against `max`
  display: string;          // what the reader sees, e.g. "72%"
  sub?: string;             // small grey note, e.g. "of 43 learners"
  color?: string;           // default: traffic light on value
}

export const BarList: React.FC<{
  rows: BarRow[];
  max?: number;
  reference?: { value: number; label: string };
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  selectHint?: string;
}> = ({ rows, max = 100, reference, activeKey, onSelect, selectHint }) => (
  <div className="space-y-2.5">
    {rows.map(row => {
      const w = max > 0 ? Math.max(0, Math.min(100, (row.value / max) * 100)) : 0;
      return (
        <button
          key={row.key}
          type="button"
          disabled={!onSelect}
          onClick={onSelect ? () => onSelect(row.key) : undefined}
          title={selectHint}
          className={cn(
            'grid w-full grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 rounded-lg px-1.5 py-1 text-left',
            onSelect && 'cursor-pointer hover:bg-surface-sunken',
            activeKey === row.key && 'bg-surface-sunken ring-1 ring-border-strong',
            activeKey && activeKey !== row.key && 'opacity-50',
          )}
        >
          <span className="truncate text-sm text-ink" title={row.label}>{row.label}</span>
          <span className="relative h-3.5 rounded-full bg-surface-sunken">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${w}%`, background: row.color ?? toneColor(row.value), transition: 'width 500ms ease' }}
            />
            {reference && (
              <span
                className="absolute -inset-y-1 w-0.5 rounded bg-ink/70"
                style={{ left: `${Math.min(100, (reference.value / max) * 100)}%` }}
                title={reference.label}
              />
            )}
          </span>
          <span className="whitespace-nowrap text-right">
            <span className="text-sm font-bold tabular-nums text-ink">{row.display}</span>
            {row.sub && <span className="ml-1.5 text-xs text-ink-faint">{row.sub}</span>}
          </span>
        </button>
      );
    })}
    {reference && (
      <div className="flex items-center gap-2 pl-1.5 text-xs text-ink-faint">
        <span className="inline-block h-3 w-0.5 rounded bg-ink/70" aria-hidden /> {reference.label}
      </div>
    )}
  </div>
);

// ── StackedBar: one whole, split into parts ─────────────────────────────────

export const StackedBar: React.FC<{
  parts: Slice[];
  height?: string;
  showLegend?: boolean;
}> = ({ parts, height = 'h-5', showLegend = true }) => {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className={cn('flex w-full overflow-hidden rounded-full bg-surface-sunken', height)}>
        {total > 0 && parts.filter(p => p.value > 0).map(p => (
          <div
            key={p.key}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color, transition: 'width 500ms ease' }}
            title={`${p.label}: ${p.value} (${fmtPct((p.value / total) * 100)})`}
          />
        ))}
      </div>
      {showLegend && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map(p => (
          <span key={p.key} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
            {p.label}
            <strong className="tabular-nums text-ink">{p.value}</strong>
            <span className="tabular-nums text-ink-faint">({total > 0 ? fmtPct((p.value / total) * 100) : '0%'})</span>
          </span>
        ))}
      </div>}
    </div>
  );
};

// ── Histogram: how the scores are spread ────────────────────────────────────

/**
 * One column per score (or score band), each with its count on top. Columns
 * below the pass mark are red/amber, at or above it green, and a dashed line
 * sits where passing starts — "most people are just under the line" reads at
 * a glance.
 */
export const Histogram: React.FC<{
  bars: { label: string; lo: number; hi: number; count: number }[];
  passMark: number;
  passLabel: string;
  countLabel: (n: number, label: string) => string;
}> = ({ bars, passMark, passLabel, countLabel }) => {
  const max = Math.max(1, ...bars.map(b => b.count));
  const firstPassing = bars.findIndex(b => b.lo >= passMark);
  const linePct = firstPassing < 0 ? 100 : (firstPassing / Math.max(1, bars.length)) * 100;
  return (
    <div>
      <div className="relative flex h-48 items-end gap-1.5 border-b border-border-strong pt-5 sm:gap-2">
        {bars.map(b => {
          const color = b.hi < passMark - 20 ? '#DC2F2F' : b.hi < passMark ? '#F59E0B' : '#2F9E56';
          return (
            <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end" title={countLabel(b.count, b.label)}>
              <span className="mb-1 text-xs font-bold tabular-nums text-ink">{b.count > 0 ? b.count : ''}</span>
              <span
                className="w-full max-w-16 rounded-t-md"
                style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count > 0 ? 3 : 0, background: color, transition: 'height 500ms ease' }}
              />
            </div>
          );
        })}
        <span
          className="pointer-events-none absolute -top-1 bottom-0 border-l-2 border-dashed border-ink/60"
          style={{ left: `${linePct}%` }}
        >
          <span className="absolute -top-1 left-1 whitespace-nowrap rounded bg-surface px-1 text-[0.7rem] font-semibold text-ink">
            {passLabel}
          </span>
        </span>
      </div>
      <div className="mt-1.5 flex gap-1.5 sm:gap-2">
        {bars.map(b => (
          <span key={b.label} className="flex-1 text-center text-[0.65rem] tabular-nums text-ink-faint sm:text-xs">{b.label}</span>
        ))}
      </div>
    </div>
  );
};

// ── PairedBars: two tests, side by side, per group ──────────────────────────

export interface PairedRow {
  key: string;
  label: string;
  a: number;
  b: number;
  sub?: string;
}

export const PairedBars: React.FC<{
  rows: PairedRow[];
  colorA: string;
  colorB: string;
  labelA: string;
  labelB: string;
  changeLabel: (change: number) => string;
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  selectHint?: string;
}> = ({ rows, colorA, colorB, labelA, labelB, changeLabel, activeKey, onSelect, selectHint }) => (
  <div>
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-muted">
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: colorA }} />{labelA}</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: colorB }} />{labelB}</span>
    </div>
    <div className="space-y-3">
      {rows.map(r => {
        const change = r.b - r.a;
        return (
          <button
            key={r.key}
            type="button"
            disabled={!onSelect}
            onClick={onSelect ? () => onSelect(r.key) : undefined}
            title={selectHint}
            className={cn(
              'grid w-full grid-cols-[minmax(6rem,11rem)_1fr_4.5rem] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left',
              onSelect && 'cursor-pointer hover:bg-surface-sunken',
              activeKey === r.key && 'bg-surface-sunken ring-1 ring-border-strong',
              activeKey && activeKey !== r.key && 'opacity-50',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-ink" title={r.label}>{r.label}</span>
              {r.sub && <span className="block text-xs text-ink-faint">{r.sub}</span>}
            </span>
            <span className="space-y-1">
              {([[r.a, colorA], [r.b, colorB]] as [number, string][]).map(([v, c], i) => (
                <span key={i} className="flex items-center gap-2">
                  <span className="relative h-3 flex-1 rounded-full bg-surface-sunken">
                    <span className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: c, transition: 'width 500ms ease' }} />
                  </span>
                  <span className="w-9 text-right text-xs font-bold tabular-nums text-ink">{fmtPct(v)}</span>
                </span>
              ))}
            </span>
            <span
              className={cn(
                'justify-self-end rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                Math.abs(change) < 1 ? 'bg-surface-sunken text-ink-muted'
                  : change > 0 ? 'bg-success-50 text-success-600 dark:bg-success-500/15'
                    : 'bg-error-50 text-error-600 dark:bg-error-500/15',
              )}
            >
              {changeLabel(change)}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

// ── HeatGrid: where each learner landed on both tests ───────────────────────

/**
 * Rows are score bands on the second test (highest on top), columns on the
 * first. Each box holds how many learners scored that pair; darker = more.
 * The diagonal (same band both times) is outlined, so boxes above it are
 * people who did better the second time and boxes below it did worse.
 */
export const HeatGrid: React.FC<{
  grid: number[][];               // [band of B][band of A]
  bands: [number, number][];
  labelA: string;
  labelB: string;
  color: string;
  cellTitle: (count: number, bandA: string, bandB: string) => string;
}> = ({ grid, bands, labelA, labelB, color, cellTitle }) => {
  const max = Math.max(1, ...grid.flat());
  const bandText = ([lo, hi]: [number, number]) => `${lo}–${hi}%`;
  const rowsTopDown = bands.map((_, i) => bands.length - 1 - i);
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full grid-cols-[auto_auto_repeat(5,minmax(3.25rem,1fr))] items-stretch gap-1">
        <div className="row-span-6 flex items-center justify-center pr-1">
          <span className="text-xs font-semibold text-ink-muted [writing-mode:vertical-rl] rotate-180">{labelB}</span>
        </div>
        {rowsTopDown.map(bi => (
          <React.Fragment key={bi}>
            <div className="flex items-center justify-end pr-2 text-xs tabular-nums text-ink-faint">{bandText(bands[bi])}</div>
            {bands.map((_, ai) => {
              const n = grid[bi][ai];
              const strength = n / max;
              return (
                <div
                  key={ai}
                  title={cellTitle(n, bandText(bands[ai]), bandText(bands[bi]))}
                  className={cn(
                    'flex h-12 items-center justify-center rounded-md text-sm font-bold tabular-nums',
                    ai === bi && 'ring-2 ring-ink/40',
                    strength > 0.55 ? 'text-white' : 'text-ink',
                  )}
                  style={{ background: n > 0 ? `color-mix(in srgb, ${color} ${Math.round(12 + strength * 88)}%, transparent)` : 'var(--color-surface-sunken)' }}
                >
                  {n > 0 ? n : ''}
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <div />
        {bands.map((b, i) => (
          <div key={i} className="pt-1 text-center text-xs tabular-nums text-ink-faint">{bandText(b)}</div>
        ))}
        <div />
        <div />
        <div className="col-span-5 pt-1 text-center text-xs font-semibold text-ink-muted">{labelA}</div>
      </div>
    </div>
  );
};

// ── Journey: how many made it to each step ──────────────────────────────────

export const Journey: React.FC<{
  steps: { key: string; label: string; count: number; icon?: React.ReactNode }[];
  total: number;
  lostLabel: (n: number) => string;
  ofLabel: (pct: string) => string;
}> = ({ steps, total, lostLabel, ofLabel }) => (
  <ol className="space-y-2">
    {steps.map((s, i) => {
      const share = total > 0 ? (s.count / total) * 100 : 0;
      const lost = i > 0 ? steps[i - 1].count - s.count : 0;
      return (
        // Phones: label on its own line, bar beneath it; wider: one row.
        <li key={s.key} className="grid grid-cols-[1.75rem_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[1.75rem_minmax(8rem,14rem)_1fr] sm:gap-y-0">
          <span className="flex size-7 items-center justify-center rounded-full bg-surface-sunken text-xs font-bold text-ink-muted [&>svg]:size-3.5">
            {s.icon ?? i + 1}
          </span>
          <span className="text-sm font-medium text-ink">{s.label}</span>
          <span className="col-start-2 flex min-w-0 items-center gap-3 sm:col-start-auto">
            <span className="relative h-7 min-w-0 flex-1 rounded-lg bg-surface-sunken">
              <span
                className="absolute inset-y-0 left-0 flex items-center rounded-lg px-2 text-xs font-bold text-white"
                style={{
                  width: `${Math.max(share, 4)}%`,
                  background: `linear-gradient(90deg, var(--color-coral-500), var(--color-coral-400))`,
                  transition: 'width 600ms ease',
                }}
              >
                <span className="tabular-nums">{s.count}</span>
              </span>
            </span>
            <span className="w-20 shrink-0 text-right text-xs sm:w-24">
              <span className="block font-semibold tabular-nums text-ink">{ofLabel(fmtPct(share))}</span>
              {lost > 0 && <span className="block tabular-nums text-error-600">{lostLabel(lost)}</span>}
            </span>
          </span>
        </li>
      );
    })}
  </ol>
);
