import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowthStandardPoint } from '../../api/growth';
import {
  clipStandards,
  formatAge,
  percentileColor,
  PERCENTILE_KEYS,
  sourceComboColor,
  type GrowthPoint,
  type GrowthSeries,
} from '../../lib/growthChart';
import { cn } from '../../utils/cn';

/**
 * One WHO growth chart: percentile background curves (P3/P15/P50/P85/P97,
 * one color each) + per-case visit polylines whose points/segments are
 * colored by the visit's data source (growth / +BF / +CF). Hovering a point
 * shows the visit metrics; clicking drills into the full visit record.
 */
interface GrowthChartProps {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  standards: GrowthStandardPoint[];
  xDomain: [number, number];
  xTicks: { value: number; label: string }[];
  /** 'age' formats hover x as an age; 'length' as centimetres. */
  xKind: 'age' | 'length';
  series: GrowthSeries[];
  onPointClick?: (point: GrowthPoint) => void;
}

const VIEW_W = 760;
const VIEW_H = 480;
const M = { top: 18, right: 44, bottom: 42, left: 48 };
const PLOT_W = VIEW_W - M.left - M.right;
const PLOT_H = VIEW_H - M.top - M.bottom;

/** 1-2-5 nice ticks covering [min, max]. */
const niceTicks = (min: number, max: number, target = 8): number[] => {
  const span = Math.max(max - min, 1e-9);
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => span / s <= target) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
};

interface Hover {
  /** Identity of the hovered point, checked against the (re-derived) series. */
  caseId: number;
  x: number;
  y: number;
  /** SVG-space position for placing the tooltip. */
  cx: number;
  cy: number;
  point: GrowthPoint;
}

const GrowthChart: React.FC<GrowthChartProps> = ({
  title,
  subtitle,
  xLabel,
  yLabel,
  standards,
  xDomain,
  xTicks,
  xKind,
  series,
  onPointClick,
}) => {
  const { t } = useTranslation('growth');
  const clipId = useId();
  const [hover, setHover] = useState<Hover | null>(null);

  // A hovered point can disappear when filters/tabs change without a mouse
  // move; drop the tooltip whenever the plotted data changes.
  useEffect(() => setHover(null), [series, xDomain, standards]);

  const clipped = useMemo(() => clipStandards(standards, xDomain), [standards, xDomain]);

  // Points outside the chart's x-domain are not drawn, so they must not stretch
  // the y-axis or suppress the empty-state message either. Everything downstream
  // derives from this clipped set.
  const visibleSeries = useMemo(
    () =>
      series
        .map(s => ({ caseId: s.caseId, points: s.points.filter(p => p.x >= xDomain[0] && p.x <= xDomain[1]) }))
        .filter(s => s.points.length > 0),
    [series, xDomain],
  );

  const yDomain = useMemo<[number, number]>(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of clipped) {
      lo = Math.min(lo, row.p3);
      hi = Math.max(hi, row.p97);
    }
    for (const s of visibleSeries) {
      for (const p of s.points) {
        lo = Math.min(lo, p.y);
        hi = Math.max(hi, p.y);
      }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    const pad = (hi - lo) * 0.06 || 1;
    return [lo - pad, hi + pad];
  }, [clipped, visibleSeries]);

  const sx = (x: number) => M.left + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * PLOT_W;
  const sy = (y: number) => M.top + PLOT_H - ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * PLOT_H;

  const yTicks = useMemo(() => niceTicks(yDomain[0], yDomain[1]), [yDomain]);

  const percentilePaths = useMemo(
    () =>
      PERCENTILE_KEYS.map(key => {
        const d = clipped
          .map((row, i) => `${i === 0 ? 'M' : 'L'}${sx(row.x).toFixed(1)},${sy(row[key]).toFixed(1)}`)
          .join(' ');
        const last = clipped[clipped.length - 1];
        return { key, d, labelY: last ? sy(last[key]) : 0 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipped, yDomain, xDomain],
  );

  const hasData = visibleSeries.length > 0;
  const hoverVisit = hover?.point.visit ?? null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card)">
      <div className="mb-2">
        <h3 className="font-display text-sm font-bold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full select-none"
          role="img"
          aria-label={title}
          onMouseLeave={() => setHover(null)}
        >
          {/* clip curves/series to the plot box so they never overdraw the
              axis tick labels or the right-margin percentile labels */}
          <defs>
            <clipPath id={clipId}>
              <rect x={M.left} y={M.top} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          </defs>

          {/* plot frame + grid */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            className="fill-transparent stroke-border"
          />
          {xTicks
            .filter(tk => tk.value >= xDomain[0] && tk.value <= xDomain[1])
            .map(tk => (
              <g key={`x${tk.value}`}>
                <line
                  x1={sx(tk.value)}
                  y1={M.top}
                  x2={sx(tk.value)}
                  y2={M.top + PLOT_H}
                  className="stroke-border"
                  strokeWidth={0.6}
                />
                {tk.label && (
                  <text
                    x={sx(tk.value)}
                    y={M.top + PLOT_H + 16}
                    textAnchor="middle"
                    className="fill-ink-muted text-[11px]"
                  >
                    {tk.label}
                  </text>
                )}
              </g>
            ))}
          {yTicks.map(tk => (
            <g key={`y${tk}`}>
              <line
                x1={M.left}
                y1={sy(tk)}
                x2={M.left + PLOT_W}
                y2={sy(tk)}
                className="stroke-border"
                strokeWidth={0.6}
              />
              <text
                x={M.left - 7}
                y={sy(tk) + 3.5}
                textAnchor="end"
                className="fill-ink-muted text-[11px]"
              >
                {tk}
              </text>
            </g>
          ))}

          {/* axis labels */}
          <text
            x={M.left + PLOT_W / 2}
            y={VIEW_H - 6}
            textAnchor="middle"
            className="fill-ink-muted text-[12px] font-semibold"
          >
            {xLabel}
          </text>
          <text
            x={13}
            y={M.top + PLOT_H / 2}
            textAnchor="middle"
            transform={`rotate(-90 13 ${M.top + PLOT_H / 2})`}
            className="fill-ink-muted text-[12px] font-semibold"
          >
            {yLabel}
          </text>

          {/* WHO percentile curves (clipped to the plot box) */}
          <g clipPath={`url(#${clipId})`}>
            {percentilePaths.map(p => (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                stroke={percentileColor(p.key)}
                strokeWidth={1.6}
                opacity={0.85}
              />
            ))}
          </g>
          {/* percentile labels sit in the right margin — NOT clipped */}
          {percentilePaths.map(p => (
            <text
              key={`lbl-${p.key}`}
              x={M.left + PLOT_W + 5}
              y={Math.max(M.top + 8, Math.min(M.top + PLOT_H, p.labelY + 3.5))}
              className="text-[11px] font-bold"
              fill={percentileColor(p.key)}
            >
              {t(`percentiles.${p.key}`)}
            </text>
          ))}

          {/* visit series: segment color = the source combo of its later point */}
          <g clipPath={`url(#${clipId})`}>
            {visibleSeries.map(s => (
              <g key={s.caseId}>
                {s.points.slice(1).map((p, i) => (
                  <line
                    key={`${s.caseId}-l${i}`}
                    x1={sx(s.points[i].x)}
                    y1={sy(s.points[i].y)}
                    x2={sx(p.x)}
                    y2={sy(p.y)}
                    stroke={sourceComboColor(p.combo)}
                    strokeWidth={2}
                    opacity={0.8}
                  />
                ))}
                {s.points.map((p, i) => (
                  <circle
                    key={`${s.caseId}-p${i}`}
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={hover && hover.caseId === s.caseId && hover.x === p.x && hover.y === p.y ? 6.5 : 4.5}
                    fill={sourceComboColor(p.combo)}
                    stroke="white"
                    strokeWidth={1.4}
                    className={cn(p.visit && onPointClick && 'cursor-pointer')}
                    onMouseEnter={() =>
                      setHover({ caseId: s.caseId, x: p.x, y: p.y, cx: sx(p.x), cy: sy(p.y), point: p })
                    }
                    onClick={() => p.visit && onPointClick?.(p)}
                  />
                ))}
              </g>
            ))}
          </g>

          {!hasData && (
            <text
              x={M.left + PLOT_W / 2}
              y={M.top + PLOT_H / 2}
              textAnchor="middle"
              className="fill-ink-faint text-[13px]"
            >
              {t('chart.noData')}
            </text>
          )}
        </svg>

        {/* hover tooltip — anchored at the point, flipped away from edges so it
            stays inside the card at the plot borders */}
        {hover && (() => {
          const nearLeft = hover.cx < M.left + PLOT_W * 0.2;
          const nearRight = hover.cx > M.left + PLOT_W * 0.8;
          const nearTop = hover.cy < M.top + PLOT_H * 0.3;
          const tx = nearLeft ? '-8px' : nearRight ? 'calc(-100% + 8px)' : '-50%';
          const ty = nearTop ? '14px' : 'calc(-100% - 12px)';
          return (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded-lg border border-border
                       bg-surface-raised p-3 text-xs shadow-(--shadow-hover)"
            style={{
              left: `${(hover.cx / VIEW_W) * 100}%`,
              top: `${(hover.cy / VIEW_H) * 100}%`,
              transform: `translate(${tx}, ${ty})`,
            }}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: sourceComboColor(hover.point.combo) }}
              />
              <span className="font-bold text-ink">{hover.point.case.child.name}</span>
            </div>
            <div className="space-y-0.5 text-ink-muted">
              <div>{t('tooltip.source')}: {t(`sources.${hover.point.combo}`)}</div>
              {hoverVisit ? (
                <>
                  <div>
                    {hoverVisit.date}
                    {hoverVisit.age_days != null && ` · ${t('tooltip.age')} ${formatAge(hoverVisit.age_days)}`}
                  </div>
                  {hoverVisit.weight != null && (
                    <div>{t('tooltip.weight')}: <b className="text-ink">{hoverVisit.weight.toFixed(3)} kg</b></div>
                  )}
                  {hoverVisit.length != null && (
                    <div>{t('tooltip.length')}: <b className="text-ink">{hoverVisit.length.toFixed(1)} cm</b></div>
                  )}
                </>
              ) : (
                <>
                  {hover.point.case.child.birth_weight != null && (
                    <div>{t('tooltip.weight')}: <b className="text-ink">{hover.point.case.child.birth_weight.toFixed(3)} kg</b></div>
                  )}
                  {hover.point.case.child.birth_length != null && (
                    <div>{t('tooltip.length')}: <b className="text-ink">{hover.point.case.child.birth_length.toFixed(1)} cm</b></div>
                  )}
                </>
              )}
              <div>
                {hover.point.case.mother.name}
                {hover.point.case.learner.name ? ` · ${hover.point.case.learner.name}` : ''}
              </div>
              {xKind === 'length' && hoverVisit?.age_days != null && (
                <div>{t('tooltip.age')}: {formatAge(hoverVisit.age_days)}</div>
              )}
            </div>
            {hoverVisit && onPointClick && (
              <div className="mt-1.5 border-t border-border pt-1.5 font-semibold text-primary">
                {t('tooltip.clickForDetails')}
              </div>
            )}
          </div>
          );
        })()}
      </div>
    </div>
  );
};

export default GrowthChart;
