import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, RotateCcw, Info, Download, ArrowLeftRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { ActivityBlock, GrowthSummaryRow, ZTriplet } from '../../api/growth';
import { caseCategory, monthsDays, pctCellFill, zCellFill } from '../../lib/growthDisplay';

/** Toggleable column groups (Identity is always shown). */
type GroupId = 'ids' | 'case' | 'fu' | 'total' | 'cg' | 'bf' | 'cf' | 'anc' | 'protein' | 'outcomes' | 'cats';

const EMPTY_BLOCK: ActivityBlock = { expected: null, actual: 0, incomplete: null, actual_pct: null, incomplete_pct: null };

interface ColDef {
  key: string;
  /** Short header code (EC/AC/IC, BV…). */
  code: string;
  /** Second sub-header line under the code (e.g. "n|%"). */
  sub?: string;
  /** Full-name tooltip. */
  title: string;
  /** Base width in px (scaled by the width slider). */
  base: number;
  align?: 'left' | 'right' | 'center';
  /** Excel-style whole-cell spectrum fill. */
  fill?: (row: GrowthSummaryRow) => string | undefined;
  render: (row: GrowthSummaryRow, index: number) => React.ReactNode;
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

/** "n|%" pair — the whole cell carries the spectrum fill, so the text stays plain ink. */
const CountPctCell: React.FC<{ count: number | null; pct: number | null }> = ({ count, pct }) => (
  <span className="tabular-nums">
    <span className={cn(count == null ? 'text-ink-faint' : 'text-ink')}>{count ?? '—'}</span>
    {pct != null && <span className="text-[12px] text-ink-muted">|{pct}</span>}
  </span>
);

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  rows: GrowthSummaryRow[];
  /** Backend mock flag (drives the demo-values banner). */
  mock: boolean;
  /** Click a row to open its full case drill-down. */
  onRowClick?: (row: GrowthSummaryRow) => void;
  /** Download the (filtered) table as .xlsx. */
  onDownloadXlsx?: () => Promise<void> | void;
  /** Offer "cases as columns" — the learner's view (review of 18 Oct 2026:
   *  "transpose the rows and columns … adoptions will be in the columns,
   *  whatever other variables come in the rows"). The supervisors' table
   *  stays horizontal. Starts transposed — cases as columns — on every screen
   *  (19 Oct 2026: "preferably let it be vertical; if they want they can
   *  always switch"); the learner's own choice is remembered. */
  allowTranspose?: boolean;
}

/** Rows drawn at first, and added each time the reader nears the bottom. */
const ROW_BATCH = 100;

const GrowthSummaryTable: React.FC<Props> = ({ rows, mock, onRowClick, onDownloadXlsx, allowTranspose = false }) => {
  const { t } = useTranslation('growth');
  const [transposed, setTransposed] = useState<boolean>(() => {
    if (!allowTranspose) return false;
    try {
      const saved = localStorage.getItem(`${PREFS_KEY}.transposed`);
      if (saved != null) return saved === '1';
    } catch { /* no storage */ }
    return true;
  });
  const flip = () => setTransposed(v => {
    try { localStorage.setItem(`${PREFS_KEY}.transposed`, v ? '0' : '1'); } catch { /* no storage */ }
    return !v;
  });

  // A project can hold ~1,000 cases of ~35 filled cells each; drawing them all
  // at once froze the page for seconds. Draw a batch, then the next as the
  // reader scrolls the table. (The XLSX download always has every row.)
  const [shown, setShown] = useState(ROW_BATCH);
  useEffect(() => { setShown(ROW_BATCH); }, [rows]);
  const showMore = () => setShown(n => Math.min(n + ROW_BATCH, rows.length));
  const onTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (shown < rows.length && el.scrollTop + el.clientHeight > el.scrollHeight - 600) showMore();
  };

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

  /** "Xm Yd" (months + leftover days); antenatal ages render as the AN shorthand. */
  const fmtMonthsDays = (days: number | null) => {
    if (days == null) return <span className="text-ink-faint">—</span>;
    if (days < 0) return <span title={t('summary.antenatal')}>{t('summary.antenatalShort')}</span>;
    const v = monthsDays(days)!;
    return `${v.m}${t('summary.monthShort')} ${v.d}${t('summary.dayShort')}`;
  };

  const activityGroup = (
    id: GroupId,
    label: string,
    title: string,
    key: 'total' | 'cg' | 'bf' | 'cf' | 'anc' | 'protein',
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
          <ExpectedCell block={r.activities[key] ?? EMPTY_BLOCK} mock={r.meta.expected_is_mock} demoLabel={demo} />
        ),
      },
      {
        key: `${id}-ac`,
        code: 'AC',
        sub: t('summary.nPct'),
        title: t('summary.ac'),
        base: 62,
        align: 'center',
        fill: r => pctCellFill((r.activities[key] ?? EMPTY_BLOCK).actual_pct),
        render: r => <CountPctCell count={(r.activities[key] ?? EMPTY_BLOCK).actual} pct={(r.activities[key] ?? EMPTY_BLOCK).actual_pct} />,
      },
      {
        key: `${id}-ic`,
        code: 'IC',
        sub: t('summary.nPct'),
        title: t('summary.ic'),
        base: 62,
        align: 'center',
        fill: r => pctCellFill((r.activities[key] ?? EMPTY_BLOCK).incomplete_pct, true),
        render: r => (
          <CountPctCell count={(r.activities[key] ?? EMPTY_BLOCK).incomplete} pct={(r.activities[key] ?? EMPTY_BLOCK).incomplete_pct} />
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
    fill: r => zCellFill(r.outcomes[metric][visit]),
    render: r => {
      const z = r.outcomes[metric][visit];
      return (
        <Mockable mock={r.meta.z_is_mock} demoLabel={demo}>
          <span className={cn('tabular-nums', z == null ? 'text-ink-faint' : 'text-ink')}>{fmtZ(z)}</span>
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
            key: 'serial',
            code: '#',
            title: t('summary.serial'),
            base: 44,
            align: 'right',
            render: (_r, index) => <span className="tabular-nums text-ink-faint">{index + 1}</span>,
          },
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
        // Who the learner is and where the case lives (review of 5 Oct 2026);
        // toggled from Layout like every other group, always in the download.
        id: 'ids',
        label: t('summary.groups.ids'),
        title: t('summary.groups.idsFull'),
        tone: 'plain',
        cols: ([
          ['learner_id', 'userId', 72, 'center'],
          ['learner_mobile', 'mobile', 104, 'left'],
          ['learner_cadre', 'cadre', 120, 'left'],
          ['mother_uid', 'motherId', 116, 'left'],
          ['case_village', 'village', 110, 'left'],
          ['case_block', 'block', 100, 'left'],
          ['case_district', 'district', 100, 'left'],
          ['case_hwc', 'facility', 130, 'left'],
        ] as const).map(([field, code, base, align]) => ({
          key: `ids_${field}`,
          code: t(`summary.ids.${code}`),
          title: t(`summary.ids.${code}Full`),
          base,
          align,
          render: (r: GrowthSummaryRow) => {
            const v = r.ids?.[field];
            return v == null || v === ''
              ? <span className="text-ink-faint">—</span>
              : <span className={cn('truncate', field === 'learner_id' && 'font-semibold tabular-nums')} title={String(v)}>{String(v)}</span>;
          },
        })),
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
            base: 96,
            align: 'left',
            render: r => {
              const cat = caseCategory(r.case_details.adoption_type, r.case_details.age_of_adoption_days);
              const isMock = cat == null ? r.meta.adoption_type_is_mock : r.meta.timing_is_mock;
              // Inner title wins over the Mockable one, so fold the demo hint in.
              const tip = [isMock ? demo : null, r.case_details.adoption_type]
                .filter(Boolean)
                .join(' · ');
              return (
                <Mockable mock={isMock} demoLabel={demo}>
                  <span title={tip || undefined}>
                    {cat ? t(`summary.cat.${cat}`) : (r.case_details.adoption_type ?? '—')}
                  </span>
                </Mockable>
              );
            },
          },
          {
            key: 'aage',
            code: t('summary.adoptAge'),
            title: t('summary.adoptAgeFull'),
            base: 84,
            align: 'center',
            render: r => (
              <Mockable mock={r.meta.timing_is_mock} demoLabel={demo}>
                {fmtMonthsDays(r.case_details.age_of_adoption_days)}
              </Mockable>
            ),
          },
          {
            key: 'adur',
            code: t('summary.duration'),
            title: t('summary.durationFull'),
            base: 84,
            align: 'center',
            render: r => (
              <Mockable mock={r.meta.timing_is_mock} demoLabel={demo}>
                {fmtMonthsDays(r.case_details.adoption_duration_days)}
              </Mockable>
            ),
          },
        ],
      },
      {
        id: 'fu',
        label: t('summary.groups.fu'),
        title: t('summary.groups.fuFull'),
        tone: 'plain',
        cols: ([
          ['fu_pregnancy', 'fuPreg'], ['fu_baby', 'fuBaby'], ['fu_to_195', 'fuTo195'],
          ['fu_from_195', 'fuFrom195'], ['fu_from_150', 'fuFrom150'],
        ] as const).map(([field, code]) => ({
          key: field,
          code: t(`summary.${code}`),
          title: t(`summary.${code}Full`),
          base: 60,
          align: 'center' as const,
          render: (r: GrowthSummaryRow) => {
            const v = r.case_details[field];
            return <span className={cn('tabular-nums', v == null ? 'text-ink-faint' : 'text-ink')}>{v == null ? '—' : v}</span>;
          },
        })),
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
      {
        id: 'cats',
        label: t('summary.groups.cats'),
        title: t('summary.groups.catsFull'),
        tone: 'outcome',
        cols: (['wfaz', 'hfaz', 'wfhz'] as const).flatMap(m => (['bv', 'av', 'lv'] as const).map(v => ({
          key: `cat_${m}_${v}`,
          code: `${m === 'wfaz' ? 'W' : m === 'hfaz' ? 'H' : 'WH'}·${v.toUpperCase()}`,
          title: t(`summary.catsTitle.${m}`, { visit: t(`summary.${v}`) }),
          base: 116,
          align: 'left' as const,
          fill: (r: GrowthSummaryRow) => zCellFill(r.outcomes[m][v]),
          render: (r: GrowthSummaryRow) => {
            const c = r.categories?.[m]?.[v];
            return c ? <span className="truncate text-ink" title={c}>{c}</span> : <span className="text-ink-faint">—</span>;
          },
        }))),
      },
      activityGroup('cg', 'CG', t('summary.groups.cg'), 'cg'),
      activityGroup('bf', 'BF', t('summary.groups.bf'), 'bf'),
      activityGroup('cf', 'CF', t('summary.groups.cf'), 'cf'),
      activityGroup('anc', 'ANC', t('summary.groups.anc'), 'anc'),
      activityGroup('protein', 'PC', t('summary.groups.protein'), 'protein'),
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
          {allowTranspose && (
            <button
              type="button"
              onClick={flip}
              aria-pressed={transposed}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                transposed ? 'border-primary/40 bg-primary/10 text-primary-ink' : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
              )}
            >
              <ArrowLeftRight className="size-4" />
              {transposed ? t('summary.casesAsRows') : t('summary.casesAsColumns')}
            </button>
          )}
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
            {(['ids', 'case', 'fu', 'total', 'outcomes', 'cats', 'cg', 'bf', 'cf', 'anc', 'protein'] as GroupId[]).map(id => (
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

      {/* cases as columns: one column per case, the measures down the side */}
      {transposed && (
        <div className="max-h-[75vh] overflow-auto rounded-xl border border-border bg-surface">
          <table className="border-collapse text-sm" style={{ width: 'max-content' }}>
            <thead className="sticky top-0 z-30">
              <tr>
                <th className="sticky left-0 z-10 min-w-36 max-w-44 border-b border-r border-border-strong bg-surface-sunken px-2 py-1.5 text-left text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                  {t('summary.measure')}
                </th>
                {rows.slice(0, shown).map((r, i) => (
                  <th
                    key={r.case_id}
                    onClick={() => onRowClick?.(r)}
                    title={onRowClick ? t('summary.clickHint') : undefined}
                    className={cn('min-w-28 max-w-40 border-b border-r border-border-strong bg-surface-sunken px-2 py-1.5 text-left text-[12px] font-semibold text-ink',
                      onRowClick && 'cursor-pointer hover:bg-surface')}
                  >
                    <span className="block text-ink-faint">#{i + 1}</span>
                    <span className="block truncate">{r.identity.mother_name}</span>
                    {r.ids?.child_name && <span className="block truncate font-normal text-ink-muted">{r.ids.child_name}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleGroups.filter(g => g.id !== 'identity').map(g => (
                <React.Fragment key={g.id}>
                  <tr>
                    <td colSpan={1 + Math.min(shown, rows.length)} className="border-b border-border-strong bg-surface-sunken/70 px-2 py-1 text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                      <span className="sticky left-2">{g.title}</span>
                    </td>
                  </tr>
                  {g.cols.map(c => (
                    <tr key={c.key} className="border-b border-border">
                      <th title={c.title} className="sticky left-0 z-20 max-w-44 border-r border-border-strong bg-surface px-2 py-1.5 text-left text-[12px] font-semibold text-ink">
                        <span className="block truncate">{c.code}{c.sub ? <span className="font-normal text-ink-faint"> {c.sub}</span> : null}</span>
                        {c.title !== c.code && <span className="block truncate text-[11px] font-normal text-ink-muted">{c.title}</span>}
                      </th>
                      {rows.slice(0, shown).map((r, i) => (
                        <td key={r.case_id} style={c.fill ? { backgroundColor: c.fill(r) } : undefined}
                          className={cn(pad, 'max-w-40 truncate border-r border-border-strong text-center')}>
                          {c.render(r, i)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-muted">{t('admin.noCases')}</div>}
        </div>
      )}

      {/* table */}
      <div onScroll={onTableScroll} className={cn('max-h-[70vh] overflow-auto rounded-xl border border-border bg-surface', transposed && 'hidden')}>
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
                    'border-b border-r border-border-strong bg-surface-sunken px-2 py-1.5 text-center text-[12px] font-bold uppercase tracking-wide text-ink-muted',
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
                g.cols.map(c => {
                  const isId = g.id === 'identity';
                  return (
                    <th
                      key={c.key}
                      title={c.title}
                      style={isId ? { left: idLeft[c.key] } : undefined}
                      className={cn(
                        'border-b border-r border-border-strong bg-surface-sunken px-2 py-1.5 text-[12px] font-semibold text-ink-muted',
                        c.align === 'left' ? 'text-left' : 'text-center',
                        isId && 'sticky z-10',
                      )}
                    >
                      {c.code}
                      {c.sub && <div className="text-xs font-normal text-ink-faint">{c.sub}</div>}
                    </th>
                  );
                }),
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {rows.slice(0, shown).map((r, rowIndex) => (
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
                  g.cols.map(c => {
                    const isId = g.id === 'identity';
                    return (
                      <td
                        key={c.key}
                        style={{
                          ...(isId ? { left: idLeft[c.key] } : {}),
                          // Excel-style conditional fill covers the whole cell
                          ...(c.fill ? { backgroundColor: c.fill(r) } : {}),
                        }}
                        className={cn(
                          pad,
                          'truncate border-r border-border-strong',
                          c.align === 'left' ? 'text-left' : c.align === 'right' ? 'text-right' : 'text-center',
                          isId && 'sticky z-20 bg-surface [tr:hover>&]:bg-surface-sunken',
                        )}
                      >
                        {c.render(r, rowIndex)}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {shown < rows.length && (
          <div className="sticky left-0 flex items-center gap-3 px-4 py-3 text-xs text-ink-muted">
            {t('summary.showing', { shown, total: rows.length })}
            <button type="button" onClick={showMore}
              className="cursor-pointer rounded-md border border-border px-2 py-1 font-semibold text-ink hover:bg-surface-sunken">
              {t('summary.showMore')}
            </button>
          </div>
        )}
        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{t('admin.noCases')}</div>
        )}
      </div>
    </div>
  );
};

export default GrowthSummaryTable;
