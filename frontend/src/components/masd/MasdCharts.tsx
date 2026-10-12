/**
 * Charts for the MASD dashboard. Dependency-free and readable without
 * hovering: every bar and bubble carries its number, colours stay consistent
 * (teal = adoption, coral = activity, grey = the earlier date), and a dashed
 * line marks the 100% target wherever there is one.
 */
import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import { MASD_COLORS, rateTone, type ColumnSeries, type RefLine } from '../../lib/masdDisplay';
export type { ColumnSeries, RefLine } from '../../lib/masdDisplay';

// ── Grouped columns ────────────────────────────────────────────────────────



export const GroupedColumns: React.FC<{
  categories: { key: string; label: string; sub?: string; group?: string }[];
  series: ColumnSeries[];
  reference?: { value: number; label: string };
  references?: RefLine[];
  height?: number;
  valueSuffix?: string;
  showValues?: boolean;
}> = ({ categories, series, reference, references = [], height = 230, valueSuffix = '', showValues = true }) => {
  const all = series.flatMap(s => s.values.filter((v): v is number => v != null));
  const lines: RefLine[] = [...(reference ? [reference] : []), ...references];
  const top = Math.max(...lines.map(r => r.value), ...all, 1);
  const max = top <= 10 ? Math.ceil(top) : Math.ceil(top / 20) * 20;
  // Category groups ("Minimum visits met: yes"), labelled above their columns.
  const groups = categories.reduce<{ label: string; span: number }[]>((acc, c) => {
    const g = c.group ?? '';
    if (acc.length && acc[acc.length - 1].label === g) acc[acc.length - 1].span += 1;
    else acc.push({ label: g, span: 1 });
    return acc;
  }, []);
  const dense = series.length >= 4 && categories.length >= 5;
  const minWidth = categories.length * Math.max(72, series.length * 30);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {series.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label}
          </span>
        ))}
        {lines.map(r => (
          <span key={`${r.label}${r.value}`} className="inline-flex items-center gap-1.5">
            <span className={cn('inline-block w-4 border-t-2', r.color ? 'border-dashed' : 'border-solid')}
              style={{ borderColor: r.color ?? 'rgb(0 0 0 / 0.7)' }} aria-hidden />
            {r.label}{r.color ? ` (${r.value.toFixed(1)}${valueSuffix})` : ''}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto pb-1">
        <div style={{ minWidth }}>
          {groups.some(g => g.label) && (
            <div className="mb-1 flex gap-2 sm:gap-3">
              {groups.map((g, i) => (
                <div key={i} style={{ flex: g.span }}
                  className="rounded-md bg-surface-sunken px-2 py-1 text-center text-xs font-bold text-ink">{g.label}</div>
              ))}
            </div>
          )}
          <div className="relative flex items-end gap-2 border-b border-border-strong sm:gap-3" style={{ height }}>
            {lines.map(r => (
              <span key={`${r.label}${r.value}`} className={cn('pointer-events-none absolute inset-x-0 z-10 border-t-2',
                r.color ? 'border-dashed' : 'border-solid')}
                style={{ bottom: `${(r.value / max) * 100}%`, borderColor: r.color ?? 'rgb(0 0 0 / 0.5)' }} />
            ))}
            {categories.map((c, ci) => (
              <div key={c.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 sm:gap-1">
                {series.map(s => {
                  const v = s.values[ci];
                  return (
                    <div key={s.key} className="flex h-full max-w-14 flex-1 flex-col items-center justify-end"
                      title={`${c.label} · ${s.label}: ${v == null ? '—' : v.toFixed(1) + valueSuffix}`}>
                      {showValues && v != null && (
                        <span className={cn('mb-0.5 font-semibold tabular-nums text-ink',
                          dense ? 'text-xs' : 'text-sm')}>
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
                {c.sub && <div className="text-xs text-ink-faint">{c.sub}</div>}
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
  /** Draw y = x: on the line, the two rates agree; off it, one runs ahead. */
  diagonal?: string;
}> = ({ bubbles, xLabel, yLabel, quadrant, sizeLabel, diagonal }) => {
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
          <text x={px(v)} y={H - B + 16} textAnchor="middle" className="fill-ink-faint text-[14px]">{v}</text>
        </g>
      ))}
      {ticks(y0, y1).map(v => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} className="stroke-border" strokeWidth={1} />
          <text x={L - 8} y={py(v) + 4} textAnchor="end" className="fill-ink-faint text-[14px]">{v}</text>
        </g>
      ))}
      {diagonal && (() => {
        const lo = Math.max(x0, y0), hi = Math.min(x1, y1);
        return hi > lo ? (
          <g>
            <line x1={px(lo)} y1={py(lo)} x2={px(hi)} y2={py(hi)} stroke="#7C5CBF" strokeWidth={1.5} strokeDasharray="2 4" />
            <text x={px(hi) - 4} y={py(hi) + 14} textAnchor="end" fill="#7C5CBF" className="text-[13px]">{diagonal}</text>
          </g>
        ) : null;
      })()}
      <line x1={px(avgX)} x2={px(avgX)} y1={T} y2={H - B} className="stroke-ink/40" strokeDasharray="5 4" />
      <line x1={L} x2={W - R} y1={py(avgY)} y2={py(avgY)} className="stroke-ink/40" strokeDasharray="5 4" />
      <text x={W - R - 4} y={T + 12} textAnchor="end" className="fill-success-600 text-[14px] font-semibold">{quadrant.topRight}</text>
      <text x={L + 6} y={T + 12} className="fill-ink-faint text-[14px]">{quadrant.topLeft}</text>
      <text x={W - R - 4} y={H - B - 8} textAnchor="end" className="fill-ink-faint text-[14px]">{quadrant.bottomRight}</text>
      <text x={L + 6} y={H - B - 8} className="fill-error-600 text-[14px] font-semibold">{quadrant.bottomLeft}</text>
      {[...bubbles].sort((a, b) => b.size - a.size).map((b, i) => {
        const color = BUBBLE_PALETTE[bubbles.indexOf(b) % BUBBLE_PALETTE.length];
        return (
          <g key={b.key}>
            <title>{`${b.label}: ${b.x.toFixed(1)}% · ${b.y.toFixed(1)}% · ${sizeLabel(b.size)}`}</title>
            <circle cx={px(b.x)} cy={py(b.y)} r={r(b.size)} fill={color} fillOpacity={0.78} stroke="white" strokeWidth={1.5}
              style={{ transition: 'all 400ms ease' }} data-i={i} />
            <text x={px(b.x) + r(b.size) + 4} y={py(b.y) + 4} className="fill-ink text-[15px] font-semibold">{b.label}</text>
          </g>
        );
      })}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="fill-ink-muted text-[15px]">{xLabel}</text>
      <text transform={`translate(14 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-muted text-[15px]">{yLabel}</text>
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
            <text x={L - 6} y={pyA(maxA * f) + 4} textAnchor="end" className="fill-ink-faint text-[14px]">{Math.round(maxA * f)}</text>
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
              <text x={px(i)} y={H - B + 16} textAnchor="middle" className="fill-ink-faint text-[14px]">{p.label}</text>
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
            <text x={tip.x + 10} y={tip.y + 18} className="fill-ink text-[15px] font-semibold">{tip.p.label}</text>
            <circle cx={tip.x + 14} cy={tip.y + 32} r={4} fill={MASD_COLORS.activity} />
            <text x={tip.x + 24} y={tip.y + 36} className="fill-ink text-[15px]">{`${labelA}: ${tip.p.a.toLocaleString()}`}</text>
            <rect x={tip.x + 10} y={tip.y + 42} width={8} height={8} rx={2} fill={MASD_COLORS.adoption} />
            <text x={tip.x + 24} y={tip.y + 50} className="fill-ink text-[15px]">{`${labelB}: ${tip.p.b.toLocaleString()}`}</text>
          </g>
        )}
      </svg>
    </div>
  );
};

// ── Table cells ────────────────────────────────────────────────────────────

/** A rate in a table cell, tinted green / amber / red. */
export const RateCell: React.FC<{
  value: number | null | undefined; lowerIsBetter?: boolean; className?: string;
  /** Small grey line under the rate, e.g. the counts it comes from ("59/55"). */
  sub?: React.ReactNode;
}> = ({ value, lowerIsBetter = false, className, sub }) => {
  const under = sub != null && <div className="mt-0.5 text-xs tabular-nums text-ink-faint">{sub}</div>;
  if (value == null) return <td className={cn('px-3 py-2 text-center text-ink-faint', className)}>—{under}</td>;
  const c = lowerIsBetter ? (value < 10 ? '#2F9E56' : value < 20 ? '#E0A11B' : '#DC2F2F') : rateTone(value);
  return (
    <td className={cn('px-2 py-1.5 text-center', className)}>
      <span className="inline-block min-w-14 rounded-md px-2 py-0.5 text-sm font-bold tabular-nums"
        style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}>
        {value.toFixed(1)}%
      </span>
      {under}
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

/** A header cell spanning a group of columns ("NFHS indicators", "Project outcomes"). */
export const GroupTh: React.FC<{ span: number; children: React.ReactNode; className?: string }> = ({ span, children, className }) => (
  <th colSpan={span} className={cn('border-l-2 border-border-strong px-3 pt-2 text-center text-xs font-bold uppercase tracking-wide text-ink', className)}>
    {children}
  </th>
);

// ── Cumulative expected vs actual (review of 6 Oct 2026) ─────────────────────

export interface CumLine {
  key: string; label: string; color: string; values: number[];
  dashed?: boolean;
  /** Dotted rather than dashed, for a third line. */
  dotted?: boolean;
  /** Drawn as steps (flat, then straight up): a target that changes on set days. */
  step?: boolean;
}

const dashOf = (l: CumLine, legend = false) => (l.dotted ? (legend ? '2 3' : '2 4') : l.dashed ? (legend ? '5 3' : '7 4') : undefined);

/** Lines that only rise: where the project should be by each date (dashed)
 *  and where it is (solid), points labelled with their numbers. */
export const CumulativeChart: React.FC<{ labels: string[]; lines: CumLine[]; height?: number }> = ({ labels, lines, height = 260 }) => {
  const [hover, setHover] = useState<number | null>(null);
  if (labels.length < 2) return null;
  const W = 820, H = height, L = 56, R = 18, T = 24, B = 34;
  const max = Math.max(1, ...lines.flatMap(l => l.values));
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = max <= 10 ? 10 : mag * Math.ceil(max / mag);
  const step = (W - L - R) / (labels.length - 1);
  const px = (i: number) => L + i * step;
  const py = (v: number) => H - B - (v / top) * (H - T - B);
  // Which points carry a label: every n-th and the last, without one
  // crowding the last (it is the report date — the number that matters).
  const marks = (n: number) => {
    const last = labels.length - 1;
    const out = new Set<number>([last]);
    for (let i = 0; i < last; i += n) if (last - i >= Math.max(1, n * 0.6)) out.add(i);
    return out;
  };
  const xMarks = marks(Math.ceil(labels.length / 10));
  const valueMarks = marks(labels.length <= 16 ? 1 : Math.ceil(labels.length / 8));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-muted">
        {lines.map(l => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={l.color} strokeWidth="2.5" strokeDasharray={dashOf(l, true)} />
            </svg>
            {l.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label={lines.map(l => l.label).join(', ')}
        onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={py(top * f)} y2={py(top * f)} className="stroke-border" />
            <text x={L - 6} y={py(top * f) + 4} textAnchor="end" className="fill-ink-faint text-[13px]">{Math.round(top * f).toLocaleString()}</text>
          </g>
        ))}
        {labels.map((lab, i) => (xMarks.has(i) ? (
          <text key={`x${i}`} x={px(i)} y={H - B + 16} textAnchor="middle" className="fill-ink-faint text-[13px]">{lab}</text>
        ) : null))}
        {lines.map(l => (
          <path key={l.key} fill="none" stroke={l.color} strokeWidth={2.5} strokeDasharray={dashOf(l)}
            strokeLinejoin="round" d={l.values.map((v, i) => (i === 0 ? `M${px(0).toFixed(1)},${py(v).toFixed(1)}`
              : l.step ? `H${px(i).toFixed(1)}V${py(v).toFixed(1)}`
                : `L${px(i).toFixed(1)},${py(v).toFixed(1)}`)).join(' ')} />
        ))}
        {lines.map(l => l.values.map((v, i) => (valueMarks.has(i) ? (
          <g key={`${l.key}${i}`}>
            <circle cx={px(i)} cy={py(v)} r={3} fill={l.color} />
            {/* Expected above its point, actual below, so close values never collide. */}
            <text x={px(i)} y={l.dashed ? py(v) - 7 : py(v) + 16} textAnchor={i === labels.length - 1 ? 'end' : 'middle'}
              className="text-[12px] font-semibold" fill={l.color}>{v.toLocaleString()}</text>
          </g>
        ) : null)))}
        {hover != null && <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} className="stroke-ink/40" strokeDasharray="4 3" />}
        {labels.map((lab, i) => (
          <rect key={`h${i}`} x={px(i) - step / 2} y={T} width={step} height={H - T - B} fill="transparent"
            onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <title>{`${lab} · ${lines.map(l => `${l.label}: ${l.values[i].toLocaleString()}`).join(' · ')}`}</title>
          </rect>
        ))}
      </svg>
      <div className="mt-1 min-h-5 text-xs text-ink">
        {hover != null && (
          <span className="flex flex-wrap gap-x-4">
            <span className="font-semibold">{labels[hover]}</span>
            {lines.map(l => <span key={l.key} style={{ color: l.color }}>{l.label}: <b>{l.values[hover].toLocaleString()}</b></span>)}
          </span>
        )}
      </div>
    </div>
  );
};
