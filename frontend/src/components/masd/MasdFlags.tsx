import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Baby, CalendarX2, MapPin, Search, Stethoscope } from 'lucide-react';
import type { FlagReason, MasdReport } from '../../api/masd';
import { Input } from '../ui';
import { BigNumber, ChipRow, Kpi, KpiRow, Section } from '../results/InsightParts';
import { BarList } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import { DataTable, Th } from './MasdCharts';
import { cn } from '../../utils/cn';

type Filter = 'all' | FlagReason;
const PAGE = 50;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const REASON_TONE: Record<FlagReason, string> = {
  edd_passed: 'bg-error-50 text-error-600 dark:bg-error-500/15',
  anc_behind: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
  no_lmp: 'bg-surface-sunken text-ink-muted',
};

/**
 * Pregnancies to follow up: the expected delivery date (LMP + 280 days) has
 * passed with no birth entered, fortnightly antenatal checks are being missed,
 * or there is no LMP to track the due date by. Mothers are shown by record ID
 * only — the learner knows who they are.
 */
const MasdFlags: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const f = report.flags;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return f.items.filter(i => (filter === 'all' || i.reasons.includes(filter))
      && (!q || [i.learner, i.block, i.mother_uid ?? ''].some(v => v.toLowerCase().includes(q))));
  }, [f.items, filter, query]);

  const maxBlock = Math.max(1, ...f.by_block.map(b => b.n));

  return (
    <div className="space-y-5">
      <KpiRow count={4}>
        <Kpi visual={<BigNumber value={f.summary.open_pregnancies.toLocaleString()} icon={f.summary.open_pregnancies ? undefined : <Baby className="size-7" />} />}
          label={t('flags.open')} value={t('flags.openSub')} />
        <Kpi visual={<BigNumber value={f.summary.edd_passed.toLocaleString()} tone={f.summary.edd_passed ? 'bad' : 'good'} />}
          label={t('flags.edd_passed')} value={t('flags.eddSub')} />
        <Kpi visual={<BigNumber value={f.summary.anc_behind.toLocaleString()} tone={f.summary.anc_behind ? 'bad' : 'good'} />}
          label={t('flags.anc_behind')} value={t('flags.ancSub')} />
        <Kpi visual={<BigNumber value={f.summary.no_lmp.toLocaleString()} />}
          label={t('flags.no_lmp')} value={t('flags.lmpSub')} />
      </KpiRow>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <Section className="lg:col-span-3" icon={<Stethoscope />} title={t('flags.findingsTitle')}>
          <MasdFindings findings={report.insights.flags} />
        </Section>
        <Section className="lg:col-span-2" icon={<MapPin />} title={t('flags.byBlock')}>
          {f.by_block.length === 0 ? <p className="text-sm text-ink-muted">{t('flags.none')}</p> : (
            <BarList max={maxBlock} rows={f.by_block.map(b => ({
              key: b.block, label: b.block, value: b.n, display: String(b.n), color: '#D6453D',
            }))} />
          )}
        </Section>
      </div>

      <Section icon={<CalendarX2 />} title={t('flags.listTitle', { count: rows.length })} subtitle={t('flags.listSub')}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ChipRow label={t('learners.show')} value={filter} onChange={v => { setFilter(v as Filter); setShown(PAGE); }}
            items={(['all', 'edd_passed', 'anc_behind', 'no_lmp'] as Filter[]).map(k => ({
              key: k, label: k === 'all' ? `${t('flags.all')} (${f.items.length})` : `${t(`flags.${k}`)} (${f.summary[k]})`,
            }))} />
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
            <Input value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE); }}
              placeholder={t('flags.search')} className="pl-9" aria-label={t('flags.search')} />
          </div>
        </div>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{t('flags.mother')}</Th>
              <Th className="text-left">{t('table.learner')}</Th>
              <Th>{t('table.block')}</Th>
              <Th>{t('flags.adopted')}</Th>
              <Th>{t('flags.lmp')}</Th>
              <Th>{t('flags.edd')}</Th>
              <Th>{t('flags.pastDue')}</Th>
              <Th title={t('flags.checksTitle')}>{t('flags.checks')}</Th>
              <Th>{t('flags.lastCheck')}</Th>
              <Th className="text-left">{t('attention.why')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(i => (
              <tr key={i.mother_id}>
                <td className="px-3 py-2 font-mono text-xs text-ink">{i.mother_uid ?? `#${i.mother_id}`}</td>
                <td className="px-3 py-2 font-medium text-ink">{i.learner}{!i.f2f && <span className="ml-1 text-xs text-ink-faint">({t('learners.notF2f')})</span>}</td>
                <td className="px-3 py-2 text-center text-ink-muted">{i.block}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmtDate(i.adopted)}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmtDate(i.lmp)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{fmtDate(i.edd)}</td>
                <td className={cn('px-3 py-2 text-center font-semibold tabular-nums', i.days_past_edd ? 'text-error-600' : 'text-ink-faint')}>
                  {i.days_past_edd == null ? '—' : t('flags.days', { n: i.days_past_edd })}
                </td>
                <td className="px-3 py-2 text-center tabular-nums">
                  <span className={cn(i.anc_expected - i.anc_done >= 2 && 'font-semibold text-amber-700 dark:text-amber-500')}>{i.anc_done}</span>
                  <span className="text-xs text-ink-faint"> / {i.anc_expected}</span>
                </td>
                <td className="px-3 py-2 text-center tabular-nums text-ink-muted">
                  {i.last_anc ? fmtDate(i.last_anc) : t('flags.never')}
                  <div className="text-xs text-ink-faint">{t('flags.daysAgo', { n: i.days_since_contact })}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {i.reasons.map(r => (
                      <span key={r} className={cn('rounded-full px-2 py-0.5 text-xs font-medium', REASON_TONE[r])}>{t(`flags.${r}`)}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-ink-muted">{t('flags.none')}</td></tr>
            )}
          </tbody>
        </DataTable>
        {rows.length > shown && (
          <div className="mt-3 flex justify-center">
            <button type="button" onClick={() => setShown(s => s + PAGE)}
              className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken">
              {t('learners.more', { n: Math.min(PAGE, rows.length - shown), left: rows.length - shown })}
            </button>
          </div>
        )}
      </Section>
    </div>
  );
};

export default MasdFlags;
