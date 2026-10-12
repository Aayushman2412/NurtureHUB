import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3, IdCard, ListTree } from 'lucide-react';
import type { MasdLearner, MasdReport } from '../../api/masd';
import { BigNumber, ChipRow, Kpi, KpiRow, Section } from '../results/InsightParts';
import { DataTable, Th } from './MasdCharts';
import { applyFilters, groupOf, groupsOf, usefulDims, type MasdDim } from '../../lib/masdSplit';
import type { MasdSplitState } from './MasdSplitBar';
import ScopeBadge from './ScopeBadge';

type DescDim = MasdDim | 'status';
const STATUS_F2F = 'F2F trained';
const STATUS_NOT = 'Registered, not trained F2F';

const groupFor = (l: MasdLearner, d: DescDim) => (d === 'status' ? (l.f2f ? STATUS_F2F : STATUS_NOT) : groupOf(l, d));
const groupsFor = (rows: MasdLearner[], d: DescDim) =>
  d === 'status' ? [STATUS_F2F, STATUS_NOT].filter(g => rows.some(l => groupFor(l, d) === g)) : groupsOf(rows, d);

const pctOf = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');

/**
 * Who the learners are (reviews of 6–7 Oct 2026): everyone registered in the
 * project, how many were trained face to face, and how they spread across
 * district, block, cadre, department, education and experience — each table
 * totalled both ways, with any two characteristics crossed.
 */
const MasdDescriptives: React.FC<{ report: MasdReport; split: MasdSplitState }> = ({ report, split }) => {
  const { t } = useTranslation('masd');
  const learners = useMemo(() => applyFilters(report.learners, split.filters), [report.learners, split.filters]);
  const dims: MasdDim[] = useMemo(() => usefulDims(report.learners).filter(d => d !== 'monitor'), [report.learners]);
  const rowDim: DescDim = dims.includes(split.dim) ? split.dim : (dims[0] ?? 'block');
  const [colDim, setColDim] = useState<DescDim>('role_group');
  const col: DescDim = colDim === rowDim ? 'status' : colDim;
  const label = (d: DescDim) => (d === 'status' ? t('descriptives.status') : t(`splitDims.${d}`));

  const f2f = learners.filter(l => l.f2f);
  const profileDims = (['district', 'block', 'role_group', 'department', 'education', 'experience', 'batch'] as MasdDim[])
    .filter(d => dims.includes(d));

  const rows = groupsFor(learners, rowDim);
  const cols = groupsFor(learners, col);
  const count = (r: string, c: string) => learners.filter(l => groupFor(l, rowDim) === r && groupFor(l, col) === c).length;
  const rowTotal = (r: string) => learners.filter(l => groupFor(l, rowDim) === r).length;
  const colTotal = (c: string) => learners.filter(l => groupFor(l, col) === c).length;

  return (
    <div className="space-y-5">
      <KpiRow count={5}>
        <Kpi visual={<BigNumber value={learners.length.toLocaleString()} />} label={t('descriptives.registered')} value={t('descriptives.registeredSub')} />
        <Kpi visual={<BigNumber value={f2f.length.toLocaleString()} />} label={t('descriptives.f2f')}
          value={t('descriptives.f2fSub', { pct: pctOf(f2f.length, learners.length) })} />
        <Kpi visual={<BigNumber value={(learners.length - f2f.length).toLocaleString()} />} label={t('descriptives.notF2f')} value={t('descriptives.notF2fSub')} />
        <Kpi visual={<BigNumber value={f2f.filter(l => l.mtfl).length.toLocaleString()} />} label={t('descriptives.mtfl')} value={t('descriptives.mtflSub')} />
        <Kpi visual={<BigNumber value={learners.filter(l => l.is_nurse).length.toLocaleString()} />} label={t('descriptives.nurses')} value={t('descriptives.nursesSub')} />
      </KpiRow>

      <Section icon={<Grid3x3 />} title={<>{t('descriptives.crossTitle', { rows: label(rowDim), cols: label(col) })}<ScopeBadge split={split} /></>} subtitle={t('descriptives.crossSub')}
        actions={<ChipRow label={t('descriptives.columns')} value={col} onChange={v => setColDim(v as DescDim)}
          items={(['status', ...dims] as DescDim[]).filter(d => d !== rowDim).map(d => ({ key: d, label: label(d) }))} />}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{label(rowDim)}</Th>
              {cols.map(c => <Th key={c}>{c}</Th>)}
              <Th>{t('table.total')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const n = rowTotal(r);
              return (
                <tr key={r}>
                  <td className="px-3 py-2 font-medium text-ink">{r}</td>
                  {cols.map(c => {
                    const v = count(r, c);
                    return (
                      <td key={c} className="px-3 py-2 text-center tabular-nums">
                        {v ? <>{v} <span className="text-xs text-ink-faint">({pctOf(v, n)})</span></> : <span className="text-ink-faint">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">{n} <span className="text-xs font-normal text-ink-faint">({pctOf(n, learners.length)})</span></td>
                </tr>
              );
            })}
            <tr className="bg-surface-sunken/50 font-semibold">
              <td className="px-3 py-2 text-ink">{t('table.total')}</td>
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-center tabular-nums">{colTotal(c)} <span className="text-xs font-normal text-ink-faint">({pctOf(colTotal(c), learners.length)})</span></td>
              ))}
              <td className="px-3 py-2 text-center tabular-nums">{learners.length}</td>
            </tr>
          </tbody>
        </DataTable>
        <p className="mt-2 text-xs text-ink-muted">{t('descriptives.crossNote')}</p>
      </Section>

      <Section icon={<ListTree />} title={<>{t('descriptives.profileTitle')}<ScopeBadge split={split} /></>} subtitle={t('descriptives.profileSub')}>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
          {profileDims.map(d => {
            const groups = groupsOf(learners, d);
            return (
              <div key={d}>
                <h4 className="mb-2 text-sm font-semibold text-ink">{label(d)}</h4>
                <DataTable>
                  <thead>
                    <tr>
                      <Th className="text-left">{label(d)}</Th>
                      <Th>{t('descriptives.registered')}</Th>
                      <Th>{t('descriptives.f2f')}</Th>
                      <Th>{t('descriptives.notF2f')}</Th>
                      <Th>{t('descriptives.pctTrained')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(g => {
                      const all = learners.filter(l => groupOf(l, d) === g);
                      const tr = all.filter(l => l.f2f).length;
                      return (
                        <tr key={g}>
                          <td className="px-3 py-1.5 text-ink">{g}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums">{all.length}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums">{tr}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums">{all.length - tr}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums">{pctOf(tr, all.length)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-surface-sunken/50 font-semibold">
                      <td className="px-3 py-1.5">{t('table.total')}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums">{learners.length}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums">{f2f.length}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums">{learners.length - f2f.length}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums">{pctOf(f2f.length, learners.length)}</td>
                    </tr>
                  </tbody>
                </DataTable>
              </div>
            );
          })}
        </div>
      </Section>

      <p className="flex items-center gap-2 text-xs text-ink-muted"><IdCard className="size-4" />{t('descriptives.note')}</p>
    </div>
  );
};

export default MasdDescriptives;
