import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hourglass } from 'lucide-react';
import { ADOPTION_TYPES, type MasdReport, type Targets } from '../../api/masd';
import { ChipRow, Section } from '../results/InsightParts';
import { StackedBar } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import { DataTable, RateCell, Th } from './MasdCharts';
import ScopeBadge from './ScopeBadge';
import { MASD_COLORS } from '../../lib/masdDisplay';
import { applyFilters, filtersActive, pct, UPTAKE_KEYS, uptakeFor, type MasdSplitState, type UptakeBucketKey } from '../../lib/masdSplit';

type Group = 'all' | 'rol' | 'sn';
// When an adoption for a tranche came: early is good, never is the worry.
const UPTAKE_COLORS: Record<UptakeBucketKey, string> = {
  before: '#2A7F8F', d7: '#2F9E56', d15: '#7FB069', d30: '#E0A11B', later: '#D6453D', not_yet: '#A8A29E',
};
const DAY = 86_400_000;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * How quickly learners took up each tranche (reviews of 6–12 Oct 2026),
 * recounted for whatever Filter by keeps: who made at least one of its
 * adoptions, who made all it asked, how many days that took — against how
 * long the tranche ran before the next one opened — and, adoption by
 * adoption, when each was made and what kind of case it was.
 */
const MasdUptake: React.FC<{ report: MasdReport; split: MasdSplitState }> = ({ report, split }) => {
  const { t } = useTranslation('masd');
  const [group, setGroup] = useState<Group>('all');
  const learners = useMemo(() => applyFilters(report.learners.filter(l => l.f2f), split.filters)
    .filter(l => group === 'all' || (group === 'sn') === l.is_nurse), [report.learners, split.filters, group]);
  const tranches = report.uptake;
  const rows = useMemo(() => tranches.map(u => ({ u, c: uptakeFor(learners, u.step) })), [tranches, learners]);
  if (!tranches.length) return null;
  const days = (n: number) => t('expected.daysN', { n });
  const iqr = (q: { median: number | null; q1: number | null; q3: number | null }) =>
    (q.median == null ? '—' : `${days(q.median)} (${q.q1 ?? '—'}–${q.q3 ?? '—'})`);
  const asked = (a: Targets) => {
    const parts = ADOPTION_TYPES.filter(k => a[k]).map(k => t(`expected.askedT.${k}`, { n: a[k] }));
    if (a.nurse) parts.push(t('expected.askedNurse', { n: a.nurse }));
    return parts.join(' · ') || '—';
  };
  // How long each tranche ran: to the next tranche's opening, the last to the report date.
  const ran = (i: number) => {
    const from = tranches[i].from;
    const to = tranches[i + 1]?.from ?? report.as_of;
    return from && to ? daysBetween(from, to) : null;
  };

  return (
    <Section icon={<Hourglass />} title={<>{t('expected.uptakeTitle')}<ScopeBadge split={split} /></>} subtitle={t('expected.uptakeSub2')}
      actions={<ChipRow label="" value={group} onChange={v => setGroup(v as Group)}
        items={(['all', 'rol', 'sn'] as Group[]).map(k => ({ key: k, label: t(`expected.upGroup.${k}`) }))} />}>
      <DataTable>
        <thead>
          <tr>
            <Th className="text-left">{t('expected.trancheHead')}</Th>
            <Th title={t('expected.ranForTitle')}>{t('expected.ranFor')}</Th>
            <Th>{t('table.learners')}</Th>
            <Th title={t('expected.startedTitle')}>{t('expected.started2')}</Th>
            <Th title={t('expected.iqrTitle')}>{t('expected.medianStartIqr')}</Th>
            <Th title={t('expected.completedTitle')}>{t('expected.completed2')}</Th>
            <Th title={t('expected.iqrTitle')}>{t('expected.medianCompleteIqr')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ u, c }, i) => (
            <tr key={u.step}>
              <td className="px-3 py-2">
                <div className="whitespace-nowrap font-medium text-ink">{t('expected.tranche', { n: u.step })}</div>
                <div className="whitespace-nowrap text-xs text-ink-faint">{u.from ? t('expected.openedOn', { date: fmtDate(u.from) }) : '—'}</div>
                <div className="max-w-[18rem] text-xs text-ink-muted">{asked(u.added)}</div>
              </td>
              <td className="px-3 py-2 text-center tabular-nums">
                {ran(i) == null ? '—' : <>{days(ran(i)!)}<div className="text-xs text-ink-faint">{i < tranches.length - 1 ? t('expected.toNext') : t('expected.toDate')}</div></>}
              </td>
              <td className="px-3 py-2 text-center tabular-nums">{c.learners}</td>
              <RateCell value={pct(c.started, c.learners)} sub={`${c.started} / ${c.learners}`} />
              <td className="px-3 py-2 text-center tabular-nums">{iqr(c.start)}</td>
              <RateCell value={pct(c.completed, c.learners)} sub={`${c.completed} / ${c.learners}`} />
              <td className="px-3 py-2 text-center tabular-nums">{iqr(c.complete)}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <h4 className="mb-1 mt-6 text-base font-bold text-ink">{t('expected.nthTitle')}</h4>
      <p className="mb-3 text-sm text-ink-muted">{t('expected.nthSub2')}</p>
      <div className="space-y-5">
        {rows.map(({ u, c }) => c.nth.length > 0 && (
          <div key={u.step}>
            <div className="mb-2 text-sm font-bold text-ink">{t('expected.tranche', { n: u.step })}</div>
            <div className="space-y-2.5">
              {c.nth.map(n => {
                const made = ADOPTION_TYPES.reduce((a, k) => a + n.types[k], 0);
                return (
                  <div key={n.n} className="grid grid-cols-1 gap-2 lg:grid-cols-[17rem_minmax(0,32rem)_1fr] lg:items-center [&>*]:min-w-0">
                    <div className="text-sm">
                      <span className="font-semibold text-ink">{t('expected.nthLabel', { n: n.n })}</span>
                      <span className="ml-1.5 text-ink-muted">{t('expected.nthDone', { done: n.done, of: n.learners })} · {iqr(n)}</span>
                    </div>
                    <StackedBar height="h-5" showLegend={false} divided
                      parts={UPTAKE_KEYS.map(b => ({ key: b, label: t(`expected.bucket.${b}`), value: n.by[b], color: UPTAKE_COLORS[b] }))} />
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {made > 0 && ADOPTION_TYPES.filter(k => n.types[k]).map(k => (
                        <span key={k} className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-ink">
                          <span className="size-2 rounded-full" style={{ background: MASD_COLORS[k] }} aria-hidden />
                          {t(`expected.kind.${k}`)} {Math.round((100 * n.types[k]) / made)}%
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {UPTAKE_KEYS.map(b => (
          <span key={b} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="size-2.5 rounded-full" style={{ background: UPTAKE_COLORS[b] }} aria-hidden />{t(`expected.bucket.${b}`)}
          </span>
        ))}
      </div>
      {!filtersActive(split.filters) && group === 'all' && <MasdFindings className="mt-5" findings={report.insights.uptake ?? []} />}
    </Section>
  );
};

export default MasdUptake;
