import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, RotateCcw, Info, Download } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { ActivityBlock, GrowthSummaryRow, ZTriplet } from '../../api/growth';

/** Toggleable column groups (Identity is always shown). */
type GroupId = 'case' | 'total' | 'cg' | 'bf' | 'cf' | 'outcomes';

interface ColDef {
  key: string;
  /** Short header code (EC/AC/IC, BV…). */
  code: string;
  /** Full-name tooltip. */
  title: string;
  /** Base width in px (scaled by the width slider). */
  base: number;
  align?: 'left' | 'right' | 'center';
  render: (row: GrowthSummaryRow) => React.ReactNode;
}

interface GroupDef {
  id: GroupId | 'identity';
  label: string;
  title: string;
  tone?: 'plain' | 'activity' | 'outcome';
  cols: ColDef[];
}

const PREFS_KEY = 'nh.growth.summary.prefs.v1';

// ── small formatters ─────────────────────────────────────────────────────────

const fmtZ = (z: number | null) => (z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}`);

const zClass = (z: number | null) =>
  z == null
    ? 'text-ink-faint'
    : z <= -3
      ? 'text-coral-700 font-semibold'
      : z <= -2
        ? 'text-amber-600'
        : z >= 3
          ? 'text-coral-600'
          : 'text-ink';

// ── cell renderers ───────────────────────────────────────────────────────────

/** Value with a dotted amber underline marking it as a demo/mock value. */
const Mockable: React.FC<{ mock: boolean; demoLabel: string; children: React.ReactNode }> = ({
  mock,
  demoLabel,
  children,
}) => (
  <span
    className={cn(mock && 'underline decoration-dotted decoration-amber-500/80 underline-offset-2')}
    title={mock ? demoLabel : undefined}
  >
    {children}
  </span>
);

const ExpectedCell: React.FC<{ block: ActivityBlock; mock: boolean; demoLabel: string }> = ({
  block,
  mock,
  demoLabel,
}) =>
  block.expected == null ? (
    <span className="text-ink-faint">—</span>
  ) : (
    <Mockable mock={mock} demoLabel={demoLabel}>
      {block.expected}
    </Mockable>
  );

/** "count (pct%)" — the % tinted by how good/bad it is. */
const CountPctCell: React.FC<{ count: number | null; pct: number | null; kind: 'ac' | 'ic' }> = ({
  count,
  pct,
  kind,
}) => {
  const pctClass =
    pct == null
      ? ''
      : kind === 'ac'
        ? pct >= 100
          ? 'text-success-600'
          : pct < 50
            ? 'text-coral-600'
            : 'text-ink-muted'
        : pct >= 50
          ? 'text-coral-600'
          : pct > 0
            ? 'text-amber-600'
            : 'text-ink-muted';
  return (
    <span className="tabular-nums">
      <span className="text-ink">{count ?? '—'}</span>
      {pct != null && <span className={cn('ml-1 text-[11px]', pctClass)}>({pct}%)</span>}
    </span>
  );
};

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  rows: GrowthSummaryRow[];
  /** Backend mock flag (drives the demo-values banner). */
  mock: boolean;
  /** Click a row to open its full case drill-down. */
  onRowClick?: (row: GrowthSummaryRow) => void;
  /** Download the (filtered) table as .xlsx. */
  onDownloadXlsx?: () => Promise<void> | void;
}

const GrowthSummaryTable: React.FC<Props> = ({ rows, mock, onRowClick, onDownloadXlsx }) => {
  const { t } = useTranslation('growth');

  const [scale, setScale] = useState(1);
  const [dense, setDense] = useState(true);
  const [hidden, setHidden] = useState<Set<GroupId>>(new Set());
  const [showControls, setShowControls] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!onDownloadXlsx) return;
    setDownloading(true);
    try {
      await onDownloadXlsx();
    } finally {
      setDownloading(false);
    }
  };

  // Persist the view preferences (width / density / hidden groups).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.scale === 'number') setScale(p.scale);
        if (typeof p.dense === 'boolean') setDense(p.dense);
        if (Array.isArray(p.hidden)) setHidden(new Set(p.hidden));
      }
    } catch {
      /* ignore malformed prefs */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ scale, dense, hidden: [...hidden] }));
    } catch {
      /* ignore quota errors */
    }
  }, [scale, dense, hidden]);

  const demo = t('summary.demoValue');

  const fmtMonths = (days: number | null) => {
    if (days == null) return <span className="text-ink-faint">—</span>;
    if (days < 0) return <span title={t('summary.antenatal')}>{t('summary.antenatalShort')}</span>;
    return `${Math.round(days / 30.44)}${t('summary.monthShort')}`;
  };

  const activityGroup = (
    id: GroupId,
    label: string,
    title: string,
    key: 'total' | 'cg' | 'bf' | 'cf',
  ): GroupDef => ({
    id,
    label,
    title,
    tone: 'activity',
    cols: [
      {
        key: `${id}-ec`,
        code: 'EC',
        title: t('summary.ec'),
        base: 44,
        align: 'center',
        render: r => (
          <ExpectedCell block={r.activities[key]} mock={r.meta.expected_is_mock} demoLabel={demo} />
        ),
      },
      {
        key: `${id}-ac`,
        code: 'AC',
        title: t('summary.ac'),
        base: 62,
        align: 'center',
        render: r => <CountPctCell count={r.activities[key].actual} pct={r.activities[key].actual_pct} kind="ac" />,
      },
      {
        key: `${id}-ic`,
        code: 'IC',
        title: t('summary.ic'),
        base: 62,
        align: 'center',
        render: r => (
          <CountPctCell count={r.activities[key].incomplete} pct={r.activities[key].incomplete_pct} kind="ic" />
        ),
      },
    ],
  });

  const zCol = (metric: 'wfaz' | 'hfaz' | 'wfhz', visit: keyof ZTriplet, code: string): ColDef => ({
    key: `${metric}-${visit}`,
    code,
    title: t(`summary.${metric}`) + ' · ' + t(`summary.${visit}`),
    base: 52,
    align: 'center',
    render: r => {
      const z = r.outcomes[metric][visit];
      return (
        <Mockable mock={r.meta.z_is_mock} demoLabel={demo}>
          <span className={cn('tabular-nums', zClass(z))}>{fmtZ(z)}</span>
        </Mockable>
      );
    },
  });

  const groups: GroupDef[] = useMemo(
    () => [
      {
        id: 'identity',
        label: t('summary.groups.identity'),
        title: t('summary.groups.identity'),
        tone: 'plain',
        cols: [
          {
            key: 'learner',
            code: t('summary.learner'),
            title: t('summary.learner'),
            base: 156,
            align: 'left',
            render: r => (
              <span className="font-semibold text-ink" title={r.identity.learner_name ?? undefined}>
                {r.identity.learner_name ?? t('admin.orphanLearner')}
              </span>
            ),
          },
          {
            key: 'mother',
            code: t('summary.mother'),
            title: t('summary.mother'),
            base: 140,
            align: 'left',
            // Child uid rides along as the hover tooltip so twin cases under the
            // same mother stay distinguishable without a dedicated column.
            render: r => <span title={`${r.identity.mother_name} · ${r.identity.child_uid}`}>{r.identity.mother_name}</span>,
          },
        ],
      },
      {
        id: 'case',
        label: t('summary.groups.case'),
        title: t('summary.groups.case'),
        tone: 'plain',
        cols: [
          {
            key: 'atype',
            code: t('summary.type'),
            title: t('summary.adoptionType'),
            base: 122,
            align: 'left',
            render: r => (
              <Mockable mock={r.meta.adoption_type_is_mock} demoLabel={demo}>
                {r.case_details.adoption_type ?? '—'}
              </Mockable>
            ),
          },
          {
            key: 'aage',
            code: t('summary.adoptAge'),
            title: t('summary.adoptAgeFull'),
            base: 68,
            align: 'center',
            render: r => (
              <Mockable mock={r.meta.timing_is_mock} demoLabel={demo}>
                {fmtMonths(r.case_details.age_of_adoption_days)}
              </Mockable>
            ),
          },
          {
            key: 'adur',
            code: t('summary.duration'),
            title: t('summary.durationFull'),
            base: 72,
            align: 'center',
            render: r => (
              <Mockable mock={r.meta.timing_is_mock} demoLabel={demo}>
                {fmtMonths(r.case_details.adoption_duration_days)}
              </Mockable>
            ),
          },
        ],
      },
      activityGroup('total', t('summary.groups.total'), t('summary.groups.totalFull'), 'total'),
      {
        id: 'outcomes',
        label: t('summary.groups.outcomes'),
        title: t('summary.groups.outcomesFull'),
        tone: 'outcome',
        cols: [
          zCol('wfaz', 'bv', 'W·BVz'),
          zCol('wfaz', 'av', 'W·AVz'),
          zCol('wfaz', 'lv', 'W·LVz'),
          zCol('hfaz', 'bv', 'H·BVz'),
          zCol('hfaz', 'av', 'H·AVz'),
          zCol('hfaz', 'lv', 'H·LVz'),
          zCol('wfhz', 'bv', 'WH·BVz'),
          zCol('wfhz', 'av', 'WH·AVz'),
          zCol('wfhz', 'lv', 'WH·LVz'),
        ],
      },
      activityGroup('cg', 'CG', t('summary.groups.cg'), 'cg'),
      activityGroup('bf', 'BF', t('summary.groups.bf'), 'bf'),
      activityGroup('cf', 'CF', t('summary.groups.cf'), 'cf'),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const visibleGroups = groups.filter(g => g.id === 'identity' || !hidden.has(g.id as GroupId));
  const flatCols = visibleGroups.flatMap(g => g.cols);
  const w = (base: number) => Math.round(base * scale);

  // Cumulative left offsets so the WHOLE identity block pins consistently on
  // horizontal scroll — the group-header colSpan and every sub/body cell line up.
  const idLeft: Record<string, number> = {};
  {
    let acc = 0;
    for (const c of groups[0].cols) {
      idLeft[c.key] = acc;
      acc += w(c.base);
    }
  }

  const toggleGroup = (id: GroupId) =>
    setHidden(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const reset = () => {
    setScale(1);
    setDense(true);
    setHidden(new Set());
  };

  const pad = dense ? 'px-2 py-1.5' : 'px-3 py-2.5';

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowControls(s => !s)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5
                       text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken"
          >
            <SlidersHorizontal className="size-4" />
            {t('summary.layout')}
          </button>
          {onDownloadXlsx && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5
                         text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken disabled:opacity-60"
            >
              <Download className="size-4" />
              {downloading ? t('summary.downloading') : t('summary.downloadXlsx')}
            </button>
          )}
        </div>
        <span className="text-xs text-ink-faint">
          {t('summary.rowCount', { count: rows.length })}
          {onRowClick && ` · ${t('summary.clickHint')}`}
        </span>
      </div>

      {showControls && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            {t('summary.width')}
            <input
              type="range"
              min={0.6}
              max={1.8}
              step={0.05}
              value={scale}
              onChange={e => setScale(Number(e.target.value))}
              className="accent-primary"
            />
            <span className="w-10 tabular-nums text-xs text-ink-faint">{Math.round(scale * 100)}%</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={dense} onChange={e => setDense(e.target.checked)} className="accent-primary" />
            {t('summary.compact')}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-muted">{t('summary.columns')}:</span>
            {(['case', 'total', 'outcomes', 'cg', 'bf', 'cf'] as GroupId[]).map(id => (
              <button
                key={id}
                type="button"
                onClick={() => toggleGroup(id)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  hidden.has(id)
                    ? 'border-border bg-surface text-ink-faint line-through'
                    : 'border-primary/30 bg-primary/10 text-primary-ink',
                )}
              >
                {groups.find(g => g.id === id)?.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <RotateCcw className="size-3.5" />
            {t('summary.reset')}
          </button>
        </div>
      )}

      {mock && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>{t('summary.mockBanner')}</span>
        </div>
      )}

      {/* table */}
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-surface">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: 'max-content' }}>
          <colgroup>
            {flatCols.map(c => (
              <col key={c.key} style={{ width: w(c.base) }} />
            ))}
          </colgroup>

          <thead className="sticky top-0 z-30">
            {/* group row */}
            <tr>
              {visibleGroups.map(g => (
                <th
                  key={g.id}
                  colSpan={g.cols.length}
                  title={g.title}
                  className={cn(
                    'border-b border-r border-border bg-surface-sunken px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-ink-muted',
                    g.id === 'identity' && 'sticky left-0 z-10',
                  )}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            {/* sub-header row */}
            <tr>
              {visibleGroups.map(g =>
                g.cols.map((c, i) => {
                  const isId = g.id === 'identity';
                  return (
                    <th
                      key={c.key}
                      title={c.title}
                      style={isId ? { left: idLeft[c.key] } : undefined}
                      className={cn(
                        'border-b border-border bg-surface-sunken px-2 py-1.5 text-[11px] font-semibold text-ink-muted',
                        c.align === 'left' ? 'text-left' : 'text-center',
                        i === g.cols.length - 1 && 'border-r',
                        isId && 'sticky z-10',
                      )}
                    >
                      {c.code}
                    </th>
                  );
                }),
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr
                key={r.case_id}
                onClick={() => onRowClick?.(r)}
                title={onRowClick ? t('summary.clickHint') : undefined}
                className={cn(
                  'transition-colors hover:bg-surface-sunken',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {visibleGroups.map(g =>
                  g.cols.map((c, i) => {
                    const isId = g.id === 'identity';
                    return (
                      <td
                        key={c.key}
                        style={isId ? { left: idLeft[c.key] } : undefined}
                        className={cn(
                          pad,
                          'truncate',
                          c.align === 'left' ? 'text-left' : c.align === 'right' ? 'text-right' : 'text-center',
                          i === g.cols.length - 1 && 'border-r border-border',
                          isId && 'sticky z-20 bg-surface [tr:hover>&]:bg-surface-sunken',
                        )}
                      >
                        {c.render(r)}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{t('admin.noCases')}</div>
        )}
      </div>
    </div>
  );
};

export default GrowthSummaryTable;
