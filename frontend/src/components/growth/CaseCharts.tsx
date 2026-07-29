import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Maximize2 } from 'lucide-react';
import { Modal } from '../ui';
import { cn } from '../../utils/cn';
import { downloadChartPng, slugify } from '../../lib/chartExport';
import type { ActivityBlock, ZTriplet, GrowthVisitDetail } from '../../api/growth';

/**
 * SVG charts for the case drill-down modal. Every chart is wrapped in a
 * ChartCard, which adds a PNG download button and an expand button that opens
 * the same plot big inside a nested modal (native <dialog> stacking).
 */

const fmtZ = (z: number | null) => (z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}`);

const zTone = (z: number | null) =>
  z == null
    ? 'text-ink-faint'
    : z <= -3 || z >= 3
      ? 'text-coral-700'
      : z <= -2
        ? 'text-amber-600'
        : 'text-ink';

// ── ChartCard: header + download / expand chrome around one SVG plot ─────────

interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Extra header content (e.g. the latest-z badge). */
  badge?: React.ReactNode;
  /** Disable download/expand (e.g. the plot has no data, so no SVG mounts). */
  exportDisabled?: boolean;
  /** Renders the SVG plot; receives the ref used for the PNG export. */
  render: (ref: React.RefObject<SVGSVGElement | null>) => React.ReactNode;
}

export const ChartCard: React.FC<ChartCardProps> = ({ title, subtitle, badge, exportDisabled, render }) => {
  const { t } = useTranslation('growth');
  const smallRef = useRef<SVGSVGElement | null>(null);
  const largeRef = useRef<SVGSVGElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  const download = async (large: boolean) => {
    const svg = large ? largeRef.current : smallRef.current;
    if (svg) await downloadChartPng(svg, `${slugify(title)}.png`, title, subtitle);
  };

  const iconBtn =
    'rounded p-1 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-bold uppercase tracking-wide text-ink-muted" title={title}>
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {badge}
          <button
            type="button"
            onClick={() => void download(false)}
            disabled={exportDisabled}
            title={t('chart.download')}
            aria-label={t('chart.download')}
            className={iconBtn}
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            disabled={exportDisabled}
            title={t('chart.expand')}
            aria-label={t('chart.expand')}
            className={iconBtn}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </span>
      </div>
      {render(smallRef)}

      {expanded && (
        <Modal
          open
          onClose={() => setExpanded(false)}
          size="xl"
          title={
            <span className="flex items-center gap-2">
              {title}
              <button
                type="button"
                onClick={() => void download(true)}
                title={t('chart.download')}
                aria-label={t('chart.download')}
                className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
              >
                <Download className="size-4" />
              </button>
            </span>
          }
        >
          {render(largeRef)}
        </Modal>
      )}
    </div>
  );
};

// ── Combined EC/AC/IC histogram (Total / CG / BF / CF on one plot) ───────────

interface ActivityChartProps {
  groups: { label: string; block: ActivityBlock }[];
  legend: { ec: string; ac: string; ic: string };
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/** Horizontal grouped bars — y axis = form group, x axis = count. */
export const ActivityComparisonChart: React.FC<ActivityChartProps> = ({ groups, legend, svgRef }) => {
  const W = 480;
  const LABEL_W = 56;
  const VALUE_W = 46;
  const BAR_H = 11;
  const BAR_GAP = 2;
  const GROUP_GAP = 12;
  const TOP = 22; // legend band
  const x0 = LABEL_W + 6;
  const x1 = W - VALUE_W;

  const series = [
    { key: 'ec' as const, label: legend.ec, cls: 'fill-cream-300 dark:fill-cream-700', pick: (b: ActivityBlock) => b.expected },
    { key: 'ac' as const, label: legend.ac, cls: 'fill-sage-500', pick: (b: ActivityBlock) => b.actual },
    { key: 'ic' as const, label: legend.ic, cls: 'fill-coral-400', pick: (b: ActivityBlock) => b.incomplete },
  ];

  const max = Math.max(1, ...groups.flatMap(g => series.map(s => s.pick(g.block) ?? 0)));
  const sx = (v: number) => x0 + (v / max) * (x1 - x0);
  const groupH = series.length * (BAR_H + BAR_GAP) - BAR_GAP;
  const H = TOP + groups.length * (groupH + GROUP_GAP);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* legend */}
      {series.map((s, i) => (
        <g key={s.key} transform={`translate(${x0 + i * 64}, 4)`}>
          <rect width={10} height={10} rx={2} className={s.cls} />
          <text x={14} y={9} fontSize={9} className="fill-current text-ink-muted">
            {s.label}
          </text>
        </g>
      ))}
      {/* baseline */}
      <line x1={x0} x2={x0} y1={TOP - 2} y2={H - GROUP_GAP + 4} className="stroke-border" />

      {groups.map((g, gi) => {
        const gy = TOP + gi * (groupH + GROUP_GAP);
        return (
          <g key={g.label}>
            <text
              x={LABEL_W}
              y={gy + groupH / 2 + 3}
              fontSize={10}
              fontWeight={700}
              textAnchor="end"
              className="fill-current text-ink-muted"
            >
              {g.label}
            </text>
            {series.map((s, si) => {
              const v = s.pick(g.block);
              const y = gy + si * (BAR_H + BAR_GAP);
              const pct = s.key === 'ac' ? g.block.actual_pct : s.key === 'ic' ? g.block.incomplete_pct : null;
              return (
                <g key={s.key}>
                  {v != null && v > 0 && (
                    <rect x={x0} y={y} width={Math.max(1.5, sx(v) - x0)} height={BAR_H} rx={2} className={s.cls} />
                  )}
                  <text
                    x={(v != null && v > 0 ? sx(v) : x0) + 4}
                    y={y + BAR_H - 2.5}
                    fontSize={9}
                    className={cn('fill-current tabular-nums', v == null ? 'text-ink-faint' : 'text-ink-muted')}
                  >
                    {v == null ? '—' : pct != null ? `${v}|${pct}` : v}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
};

// ── Diverging outcomes chart (all z triplets around a central zero line) ─────

interface OutcomeChartProps {
  outcomes: { wfaz: ZTriplet; hfaz: ZTriplet; wfhz: ZTriplet };
  /** Metric legend text (full names for the tooltip-less SVG legend). */
  legend: { wfaz: string; hfaz: string; wfhz: string };
  visitLabels: { bv: string; av: string; lv: string };
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/** Horizontal bars left/right of a central 0 line; one colour per metric. */
export const OutcomeDivergingChart: React.FC<OutcomeChartProps> = ({ outcomes, legend, visitLabels, svgRef }) => {
  const W = 480;
  const LABEL_W = 58;
  const TOP = 34; // legend + axis labels
  const BAR_H = 10;
  const BAR_GAP = 3;
  const GROUP_GAP = 10;
  const Z_MAX = 4;
  const x0 = LABEL_W + 6;
  const x1 = W - 10;
  const cx = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  const sx = (z: number) => cx + (Math.max(-Z_MAX, Math.min(Z_MAX, z)) / Z_MAX) * half;

  // Short codes in the legend (the full names overflow the viewBox and get
  // clipped in both locales); the full name rides along as the hover <title>.
  const metrics = [
    { key: 'wfaz' as const, code: 'W', short: 'WFAz', label: legend.wfaz, cls: 'fill-sky-500' },
    { key: 'hfaz' as const, code: 'H', short: 'HFAz', label: legend.hfaz, cls: 'fill-violet-500' },
    { key: 'wfhz' as const, code: 'WH', short: 'WFHz', label: legend.wfhz, cls: 'fill-teal-500' },
  ];
  const visits: (keyof ZTriplet)[] = ['bv', 'av', 'lv'];

  const groupH = visits.length * (BAR_H + BAR_GAP) - BAR_GAP;
  const H = TOP + metrics.length * (groupH + GROUP_GAP);

  const refLines = [
    { z: 0, cls: 'stroke-border-strong', dash: '' },
    { z: 2, cls: 'stroke-amber-400/70', dash: '3 3' },
    { z: -2, cls: 'stroke-amber-400/70', dash: '3 3' },
    { z: 3, cls: 'stroke-coral-400/70', dash: '2 3' },
    { z: -3, cls: 'stroke-coral-400/70', dash: '2 3' },
  ];

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* legend */}
      {metrics.map((m, i) => (
        <g key={m.key} transform={`translate(${x0 + i * 72}, 4)`}>
          <title>{m.label}</title>
          <rect width={10} height={10} rx={2} className={m.cls} />
          <text x={14} y={9} fontSize={9} className="fill-current text-ink-muted">
            {m.short}
          </text>
        </g>
      ))}
      {/* reference lines + axis labels */}
      {refLines.map(l => (
        <g key={l.z}>
          <line x1={sx(l.z)} x2={sx(l.z)} y1={TOP - 4} y2={H - GROUP_GAP + 4} className={l.cls} strokeDasharray={l.dash} />
          <text x={sx(l.z)} y={TOP - 8} fontSize={8} textAnchor="middle" className="fill-current text-ink-faint">
            {l.z > 0 ? `+${l.z}` : l.z}
          </text>
        </g>
      ))}

      {metrics.map((m, mi) => {
        const gy = TOP + mi * (groupH + GROUP_GAP);
        return (
          <g key={m.key}>
            {visits.map((v, vi) => {
              const z = outcomes[m.key][v];
              const y = gy + vi * (BAR_H + BAR_GAP);
              return (
                <g key={v}>
                  <text
                    x={LABEL_W}
                    y={y + BAR_H - 2}
                    fontSize={9}
                    fontWeight={700}
                    textAnchor="end"
                    className="fill-current text-ink-muted"
                  >
                    {`${m.code}·${visitLabels[v]}`}
                  </text>
                  {z != null && (
                    <>
                      <rect
                        x={Math.min(cx, sx(z))}
                        y={y}
                        width={Math.max(1.5, Math.abs(sx(z) - cx))}
                        height={BAR_H}
                        rx={2}
                        className={m.cls}
                      />
                      {/* clamp the label inside the plot so extreme z (clamped
                          at ±4) neither collides with row labels nor clips */}
                      <text
                        x={z < 0 ? Math.max(sx(z) - 4, x0 + 22) : Math.min(sx(z) + 4, x1 - 22)}
                        y={y + BAR_H - 2}
                        fontSize={9}
                        textAnchor={z < 0 ? 'end' : 'start'}
                        className="fill-current tabular-nums text-ink-muted"
                      >
                        {fmtZ(z)}
                      </text>
                    </>
                  )}
                  {z == null && (
                    <text x={cx + 4} y={y + BAR_H - 2} fontSize={9} className="fill-current text-ink-faint">
                      —
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
};

// ── z trend across visits (dots + line with 0 / ±2 / ±3 bands) ───────────────

interface ZTrendProps {
  label: string;
  visits: GrowthVisitDetail[];
  pick: (v: GrowthVisitDetail) => number | null;
}

const ZTrendSvg: React.FC<ZTrendProps & { svgRef: React.RefObject<SVGSVGElement | null> }> = ({
  visits,
  pick,
  svgRef,
}) => {
  const { t } = useTranslation('growth');
  const pts = visits
    .map((v, i) => ({ x: v.age_days ?? i, z: pick(v) }))
    .filter((p): p is { x: number; z: number } => p.z != null);

  const W = 232;
  const H = 120;
  const PAD = { l: 20, r: 8, t: 8, b: 14 };
  const zMin = -4;
  const zMax = 4;
  const xs = pts.map(p => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const sx = (x: number) => PAD.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (z: number) =>
    PAD.t + (1 - (Math.max(zMin, Math.min(zMax, z)) - zMin) / (zMax - zMin)) * (H - PAD.t - PAD.b);

  if (pts.length === 0) {
    return (
      <div className="flex h-[104px] items-center justify-center text-xs text-ink-faint">
        {t('caseDetail.noPlotData')}
      </div>
    );
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* reference bands */}
      {[
        { z: 0, cls: 'stroke-border', dash: '' },
        { z: 2, cls: 'stroke-amber-400/70', dash: '3 3' },
        { z: -2, cls: 'stroke-amber-400/70', dash: '3 3' },
        { z: 3, cls: 'stroke-coral-400/70', dash: '2 3' },
        { z: -3, cls: 'stroke-coral-400/70', dash: '2 3' },
      ].map(l => (
        <g key={l.z}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(l.z)} y2={sy(l.z)} className={l.cls} strokeDasharray={l.dash} />
          <text x={2} y={sy(l.z) + 3} className="fill-current text-ink-faint" fontSize={8}>
            {l.z > 0 ? `+${l.z}` : l.z}
          </text>
        </g>
      ))}
      {pts.length > 1 && (
        <polyline
          points={pts.map(p => `${sx(p.x)},${sy(p.z)}`).join(' ')}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.6}
        />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.z)} r={2.4} className="fill-primary">
          <title>{`z ${fmtZ(p.z)}`}</title>
        </circle>
      ))}
    </svg>
  );
};

/** One z-trend plot in a ChartCard, with the latest z as the header badge. */
export const ZTrendCard: React.FC<ZTrendProps> = props => {
  const { label, visits, pick } = props;
  const zs = visits.map(pick).filter((z): z is number => z != null);
  const latest = zs.length > 0 ? zs[zs.length - 1] : null;
  return (
    <ChartCard
      title={label}
      badge={<span className={cn('mr-1 text-xs font-semibold tabular-nums', zTone(latest))}>{fmtZ(latest)}</span>}
      exportDisabled={zs.length === 0} // empty state mounts no SVG to export
      render={ref => <ZTrendSvg {...props} svgRef={ref} />}
    />
  );
};
