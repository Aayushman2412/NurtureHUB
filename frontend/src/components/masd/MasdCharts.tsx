/**
 * Charts for the MASD dashboard. Dependency-free and readable without
 * hovering: every bar and bubble carries its number, colours stay consistent
 * (teal = adoption, coral = activity, grey = the earlier date), and a dashed
 * line marks the 100% target wherever there is one.
 */
import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import { MASD_COLORS, rateTone } from '../../lib/masdDisplay';

// ── Grouped columns ────────────────────────────────────────────────────────

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

export const GroupedColumns: React.FC<{
  categories: { key: string; label: string; sub?: string }[];
  series: ColumnSeries[];
  reference?: { value: number; label: string };
  height?: number;
  valueSuffix?: string;
  showValues?: boolean;
}> = ({ categories, series, reference, height = 230, valueSuffix = '', showValues = true }) => {
  const all = series.flatMap(s => s.values.filter((v): v is number => v != null));
  const top = Math.max(reference?.value ?? 0, ...all, 1);
  const max = top <= 10 ? Math.ceil(top) : Math.ceil(top / 20) * 20;
  const refPct = reference ? (reference.value / max) * 100 : null;
  const dense = series.length >= 4 && categories.length >= 5;
  const minWidth = categories.length * Math.max(56, series.length * 22);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {series.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label}
          </span>
        ))}
        {reference && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-ink/60" aria-hidden />{reference.label}
          </span>
        )}
      </div>
      <div className="overflow-x-auto pb-1">
        <div style={{ minWidth }}>
          <div className="relative flex items-end gap-2 border-b border-border-strong sm:gap-3" style={{ height }}>
            {refPct != null && (
              <span className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-ink/50"
                style={{ bottom: `${refPct}%` }} />
            )}
            {categories.map((c, ci) => (
              <div key={c.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 sm:gap-1">
                {series.map(s => {
                  const v = s.values[ci];
                  return (
                    <div key={s.key} className="flex h-full max-w-9 flex-1 flex-col items-center justify-end"
                      title={`${c.label} · ${s.label}: ${v == null ? '—' : v.toFixed(1) + valueSuffix}`}>
                      {showValues && v != null && (
                        <span className={cn('mb-0.5 font-semibold tabular-nums text-ink',
                          dense ? 'text-[0.55rem] sm:text-[0.62rem]' : 'text-[0.62rem] sm:text-[0.68rem]')}>
                          {v >= 100 || valueSuffix === '' ? Math.round(v) : v.toFixed(0)}
                        </span>
                      )}
                      <span className="w-full rounded-t"
                        style={{ height: `${v == null ? 0 : Math.max((v / max) * 100, v > 0 ? 1.5 : 0)}%`,
                          background: s.color, transition: 'height 500ms ease' }} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 sm:gap-3">
            {categories.map(c => (
              <div key={c.key} className="min-w-0 flex-1 text-center">
                <div className="truncate text-xs font-medium text-ink" title={c.label}>{c.label}</div>
                {c.sub && <div className="text-[0.68rem] text-ink-faint">{c.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Bubble plot: adoption (x) vs activity (y) ──────────────────────────────

export interface Bubble {
  key: string;
  label: string;
  x: number;
  y: number;
  size: number;
}

const BUBBLE_PALETTE = ['#E85D4C', '#2A7F8F', '#7C5CBF', '#E0A11B', '#5C9E3C', '#C2410C', '#3B6EA8', '#8A6E4B', '#B83280', '#4B8F8C'];

export const BubblePlot: React.FC<{
  bubbles: Bubble[];
  xLabel: string;
  yLabel: string;
  quadrant: { topRight: string; topLeft: string; bottomRight: string; bottomLeft: string };
  sizeLabel: (n: number) => string;
}> = ({ bubbles, xLabel, yLabel, quadrant, sizeLabel }) => {
  if (!bubbles.length) return null;
  const W = 640, H = 380, L = 52, R = 18, T = 18, B = 46;
  const xs = bubbles.map(b => b.x), ys = bubbles.map(b => b.y);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - 8) / 10) * 10);
  const x1 = Math.ceil((Math.max(...xs) + 8) / 10) * 10;
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 8) / 10) * 10);
  const y1 = Math.ceil((Math.max(...ys) + 8) / 10) * 10;
  const px = (v: number) => L + ((v - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const py = (v: number) => H - B - ((v - y0) / Math.max(1, y1 - y0)) * (H - T - B);
  const maxSize = Math.max(...bubbles.map(b => b.size), 1);
  const r = (n: number) => 7 + 20 * Math.sqrt(n / maxSize);
  const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ticks = (a: number, b: number) => {
    const step = b - a > 60 ? 20 : 10;
    const out: number[] = [];
    for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v);
    return out;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${xLabel} / ${yLabel}`}>
      {ticks(x0, x1).map(v => (
        <g key={`x${v}`}>
          <line x1={px(v)} x2={px(v)} y1={T} y2={H - B} className="stroke-border" strokeWidth={1} />
          <text x={px(v)} y={H - B + 16} textAnchor="middle" className="fill-ink-faint text-[11px]">{v}</text>
        </g>
      ))}
      {ticks(y0, y1).map(v => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} className="stroke-border" strokeWidth={1} />
          <text x={L - 8} y={py(v) + 4} textAnchor="end" className="fill-ink-faint text-[11px]">{v}</text>
        </g>
      ))}
      <line x1={px(avgX)} x2={px(avgX)} y1={T} y2={H - B} className="stroke-ink/40" strokeDasharray="5 4" />
      <line x1={L} x2={W - R} y1={py(avgY)} y2={py(avgY)} className="stroke-ink/40" strokeDasharray="5 4" />
      <text x={W - R - 4} y={T + 12} textAnchor="end" className="fill-success-600 text-[11px] font-semibold">{quadrant.topRight}</text>
      <text x={L + 6} y={T + 12} className="fill-ink-faint text-[11px]">{quadrant.topLeft}</text>
      <text x={W - R - 4} y={H - B - 8} textAnchor="end" className="fill-ink-faint text-[11px]">{quadrant.bottomRight}</text>
      <text x={L + 6} y={H - B - 8} className="fill-error-600 text-[11px] font-semibold">{quadrant.bottomLeft}</text>
      {[...bubbles].sort((a, b) => b.size - a.size).map((b, i) => {
        const color = BUBBLE_PALETTE[bubbles.indexOf(b) % BUBBLE_PALETTE.length];
        return (
          <g key={b.key}>
            <title>{`${b.label}: ${b.x.toFixed(1)}% · ${b.y.toFixed(1)}% · ${sizeLabel(b.size)}`}</title>
            <circle cx={px(b.x)} cy={py(b.y)} r={r(b.size)} fill={color} fillOpacity={0.78} stroke="white" strokeWidth={1.5}
              style={{ transition: 'all 400ms ease' }} data-i={i} />
            <text x={px(b.x) + r(b.size) + 4} y={py(b.y) + 4} className="fill-ink text-[12px] font-semibold">{b.label}</text>
          </g>
        );
      })}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="fill-ink-muted text-[12px]">{xLabel}</text>
      <text transform={`translate(14 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-muted text-[12px]">{yLabel}</text>
    </svg>
  );
};

// ── Weekly trend ───────────────────────────────────────────────────────────

export const TrendLine: React.FC<{
  points: { label: string; a: number; b: number }[];
  labelA: string;
  labelB: string;
}> = ({ points, labelA, labelB }) => {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const W = 760, H = 230, L = 40, R = 12, T = 16, B = 34;
  const maxA = Math.max(...points.map(p => p.a), 1);
  const maxB = Math.max(...points.map(p => p.b), 1);
  const step = (W - L - R) / (points.length - 1);
  const px = (i: number) => L + i * step;
  const pyA = (v: number) => H - B - (v / maxA) * (H - T - B);
  const barH = (v: number) => (v / maxB) * (H - T - B) * 0.35;
  const barW = Math.max(4, ((W - L - R) / points.length) * 0.45);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${pyA(p.a).toFixed(1)}`).join(' ');
  const area = `${path} L${px(points.length - 1)},${H - B} L${px(0)},${H - B} Z`;
  const every = Math.ceil(points.length / 9);

  // The hovered week's label: three lines, kept inside the chart.
  const tip = hover == null ? null : (() => {
    const p = points[hover];
    const longest = Math.max(p.label.length, `${labelA}: ${p.a}`.length, `${labelB}: ${p.b}`.length);
    const w = Math.max(150, 30 + longest * 7), h = 58;
    const x = Math.min(Math.max(px(hover) - w / 2, L), W - R - w);
    const above = pyA(p.a) - h - 12;
    const y = above >= 2 ? above : Math.min(pyA(p.a) + 12, H - B - h);
    return { p, x, y, w, h };
  })();

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: MASD_COLORS.activity }} />{labelA}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: MASD_COLORS.adoption }} />{labelB}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none select-none" role="img" aria-label={labelA}
        onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={pyA(maxA * f)} y2={pyA(maxA * f)} className="stroke-border" />
            <text x={L - 6} y={pyA(maxA * f) + 4} textAnchor="end" className="fill-ink-faint text-[11px]">{Math.round(maxA * f)}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <rect key={`b${i}`} x={px(i) - barW / 2} width={barW} y={H - B - barH(p.b)} height={barH(p.b)}
            fill={MASD_COLORS.adoption} fillOpacity={hover === i ? 0.9 : 0.55} rx={2} />
        ))}
        <path d={area} fill={MASD_COLORS.activity} fillOpacity={0.1} />
        <path d={path} fill="none" stroke={MASD_COLORS.activity} strokeWidth={2.5} strokeLinejoin="round" />
        {hover != null && (
          <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} className="stroke-ink/40" strokeDasharray="4 3" />
        )}
        {points.map((p, i) => (
          <g key={`p${i}`}>
            <circle cx={px(i)} cy={pyA(p.a)} r={hover === i ? 5.5 : 3.2} fill={MASD_COLORS.activity}
              stroke={hover === i ? 'white' : 'none'} strokeWidth={2} />
            {i % every === 0 && (
              <text x={px(i)} y={H - B + 16} textAnchor="middle" className="fill-ink-faint text-[11px]">{p.label}</text>
            )}
          </g>
        ))}
        {/* One invisible column per week, so the whole column — not just the
            small dot — brings up that week's numbers. */}
        {points.map((p, i) => (
          <rect key={`h${i}`} x={px(i) - step / 2} y={T} width={step} height={H - T - B} fill="transparent"
            onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <title>{`${p.label} · ${labelA}: ${p.a} · ${labelB}: ${p.b}`}</title>
          </rect>
        ))}
        {tip && (
          <g pointerEvents="none">
            <rect x={tip.x} y={tip.y} width={tip.w} height={tip.h} rx={8} className="fill-surface stroke-border-strong" strokeWidth={1} />
            <text x={tip.x + 10} y={tip.y + 18} className="fill-ink text-[12px] font-semibold">{tip.p.label}</text>
            <circle cx={tip.x + 14} cy={tip.y + 32} r={4} fill={MASD_COLORS.activity} />
            <text x={tip.x + 24} y={tip.y + 36} className="fill-ink text-[12px]">{`${labelA}: ${tip.p.a.toLocaleString()}`}</text>
            <rect x={tip.x + 10} y={tip.y + 42} width={8} height={8} rx={2} fill={MASD_COLORS.adoption} />
            <text x={tip.x + 24} y={tip.y + 50} className="fill-ink text-[12px]">{`${labelB}: ${tip.p.b.toLocaleString()}`}</text>
          </g>
        )}
      </svg>
    </div>
  );
};

// ── Table cells ────────────────────────────────────────────────────────────

/** A rate in a table cell, tinted green / amber / red. */
export const RateCell: React.FC<{ value: number | null | undefined; lowerIsBetter?: boolean; className?: string }> = ({
  value, lowerIsBetter = false, className,
}) => {
  if (value == null) return <td className={cn('px-3 py-2 text-center text-ink-faint', className)}>—</td>;
  const c = lowerIsBetter ? (value < 10 ? '#2F9E56' : value < 20 ? '#E0A11B' : '#DC2F2F') : rateTone(value);
  return (
    <td className={cn('px-2 py-1.5 text-center', className)}>
      <span className="inline-block min-w-14 rounded-md px-2 py-0.5 text-sm font-bold tabular-nums"
        style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}>
        {value.toFixed(1)}%
      </span>
    </td>
  );
};

export const Th: React.FC<{ children?: React.ReactNode; className?: string; title?: string }> = ({ children, className, title }) => (
  <th title={title} className={cn('whitespace-nowrap px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted', className)}>
    {children}
  </th>
);

export const DataTable: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('overflow-x-auto rounded-xl border border-border', className)}>
    <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-border [&_tbody_tr:hover]:bg-surface-sunken/60 [&_thead]:bg-surface-sunken">
      {children}
    </table>
  </div>
);
