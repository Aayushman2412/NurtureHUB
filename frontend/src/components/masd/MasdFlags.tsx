import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Baby, CalendarX2, Download, MapPin, Search, Shuffle, Stethoscope } from 'lucide-react';
import {
  downloadFlagList, type AdoptionType, type FlagReason, type MasdReport, type PncFlagReason,
} from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { Button, Input } from '../ui';
import { BigNumber, ChipRow, Kpi, KpiRow, Section } from '../results/InsightParts';
import { BarList } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import { DataTable, Th } from './MasdCharts';
import { cn } from '../../utils/cn';

type List = 'anc' | 'pnc' | 'mismatch';
type Filter = 'all' | FlagReason;
type PncFilter = 'all' | PncFlagReason;
const PAGE = 50;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const REASON_TONE: Record<FlagReason | PncFlagReason, string> = {
  edd_passed: 'bg-error-50 text-error-600 dark:bg-error-500/15',
  anc_behind: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
  no_lmp: 'bg-surface-sunken text-ink-muted',
  visits_missed: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500',
  no_recent_visit: 'bg-error-50 text-error-600 dark:bg-error-500/15',
};

const Picker: React.FC<{ label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }> = ({
  label, value, options, onChange,
}) => (
  <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}
    className="cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink">
    <option value="">{label}</option>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

/**
 * Cases to follow up (reviews of 7 Oct 2026). Pregnant (ANC) cases: the due
 * date (as per LMP) has passed with no birth entered, fortnightly antenatal
 * checks are being missed, or there is no LMP. PNC cases: a baby whose growth
 * checks are behind the LAP schedule or who has not been seen for weeks — the
 * learner stopped following the mother after the birth. And adoptions whose
 * type the learner chose differs from the one worked out from the dates.
 * Mothers by record ID only — the learner knows who they are.
 */
const MasdFlags: React.FC<{ report: MasdReport; project: string; asOf?: string }> = ({ report, project, asOf }) => {
  const { t } = useTranslation('masd');
  const { showToast } = useToast();
  const f = report.flags;
  const pnc = useMemo(() => f.pnc ?? [], [f.pnc]);
  const mismatch = useMemo(() => f.type_mismatch ?? [], [f.type_mismatch]);
  const [list, setList] = useState<List>('anc');
  const [filter, setFilter] = useState<Filter>('all');
  const [pncFilter, setPncFilter] = useState<PncFilter>('all');
  const [type, setType] = useState('');
  const [block, setBlock] = useState('');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const q = query.trim().toLowerCase();
  const hit = (...vals: (string | null | undefined)[]) => !q || vals.some(v => (v ?? '').toLowerCase().includes(q));
  const blocks = useMemo(() => [...new Set([...f.items, ...pnc, ...mismatch].map(i => i.block))].sort(), [f.items, pnc, mismatch]);

  const ancRows = useMemo(() => f.items.filter(i => (filter === 'all' || i.reasons.includes(filter))
    && (!block || i.block === block) && hit(i.learner, i.block, i.mother_uid)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [f.items, filter, block, q]);
  const pncRows = useMemo(() => pnc.filter(i => (pncFilter === 'all' || i.reasons.includes(pncFilter))
    && (!type || i.type === type) && (!block || i.block === block) && hit(i.learner, i.block, i.mother_uid, i.monitor)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pnc, pncFilter, type, block, q]);
  const mismatchRows = useMemo(() => mismatch.filter(i => (!type || i.computed === type) && (!block || i.block === block)
    && hit(i.learner, i.block, i.mother_uid, i.monitor)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [mismatch, type, block, q]);
  const count = list === 'anc' ? ancRows.length : list === 'pnc' ? pncRows.length : mismatchRows.length;

  const maxBlock = Math.max(1, ...f.by_block.map(b => b.n));
  const reset = () => setShown(PAGE);

  const download = async () => {
    setBusy(true);
    try {
      await downloadFlagList(project, list, {
        asOf,
        types: type ? [type] : undefined,
        blocks: block ? [block] : undefined,
        reasons: list === 'anc' && filter !== 'all' ? [filter] : list === 'pnc' && pncFilter !== 'all' ? [pncFilter] : undefined,
      });
    } catch {
      showToast(t('downloadFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const typeOptions = (['pnc_lt5', 'pnc_ge5', 'anc'] as AdoptionType[]).map(k => ({ value: k, label: t(`types.${k}`) }));
  const more = (n: number) => n > shown && (
    <div className="mt-3 flex justify-center">
      <button type="button" onClick={() => setShown(s => s + PAGE)}
        className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken">
        {t('learners.more', { n: Math.min(PAGE, n - shown), left: n - shown })}
      </button>
    </div>
  );
  const reasonPills = (reasons: (FlagReason | PncFlagReason)[]) => (
    <div className="flex flex-wrap gap-1">
      {reasons.map(r => (
        <span key={r} className={cn('rounded-full px-2 py-0.5 text-xs font-medium', REASON_TONE[r])}>{t(`flags.${r}`)}</span>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <KpiRow count={4}>
        <Kpi visual={<BigNumber value={f.summary.open_pregnancies.toLocaleString()} icon={f.summary.open_pregnancies ? undefined : <Baby className="size-7" />} />}
          label={t('flags.open')} value={t('flags.openSub')} />
        <Kpi visual={<BigNumber value={f.summary.edd_passed.toLocaleString()} tone={f.summary.edd_passed ? 'bad' : 'good'} />}
          label={t('flags.edd_passed')} value={t('flags.eddSub')} />
        <Kpi visual={<BigNumber value={(f.pnc_summary?.flagged ?? 0).toLocaleString()} tone={f.pnc_summary?.flagged ? 'bad' : 'good'} />}
          label={t('flags.pncFlagged')} value={t('flags.pncFlaggedSub', { n: (f.pnc_summary?.followed ?? 0).toLocaleString() })} />
        <Kpi visual={<BigNumber value={mismatch.length.toLocaleString()} tone={mismatch.length ? 'bad' : 'good'} />}
          label={t('flags.mismatch')} value={t('flags.mismatchSub')} />
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

      <Section
        icon={list === 'mismatch' ? <Shuffle /> : <CalendarX2 />}
        title={t(`flags.listTitle_${list}`, { count })}
        subtitle={t(`flags.listSub_${list}`)}
        actions={<Button variant="outline" size="sm" iconLeft={<Download className="size-4" />} loading={busy}
          disabled={!count} onClick={() => void download()}>{t('flags.download')}</Button>}
      >
        <div className="mb-3">
          <ChipRow label={t('flags.list')} value={list} onChange={v => { setList(v as List); setType(''); reset(); }}
            items={[
              { key: 'anc', label: `${t('flags.list_anc')} (${f.items.length})` },
              { key: 'pnc', label: `${t('flags.list_pnc')} (${pnc.length})` },
              { key: 'mismatch', label: `${t('flags.list_mismatch')} (${mismatch.length})` },
            ]} />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {list === 'anc' && (
            <ChipRow label={t('learners.show')} value={filter} onChange={v => { setFilter(v as Filter); reset(); }}
              items={(['all', 'edd_passed', 'anc_behind', 'no_lmp'] as Filter[]).map(k => ({
                key: k, label: k === 'all' ? t('flags.all') : `${t(`flags.${k}`)} (${f.summary[k]})`,
              }))} />
          )}
          {list === 'pnc' && (
            <ChipRow label={t('learners.show')} value={pncFilter} onChange={v => { setPncFilter(v as PncFilter); reset(); }}
              items={(['all', 'visits_missed', 'no_recent_visit'] as PncFilter[]).map(k => ({
                key: k, label: k === 'all' ? t('flags.all') : `${t(`flags.${k}`)} (${f.pnc_summary?.[k] ?? 0})`,
              }))} />
          )}
          {list !== 'anc' && <Picker label={t('flags.anyType')} value={type} options={typeOptions} onChange={v => { setType(v); reset(); }} />}
          <Picker label={t('flags.anyBlock')} value={block} options={blocks.map(b => ({ value: b, label: b }))} onChange={v => { setBlock(v); reset(); }} />
          <div className="relative w-full sm:ml-auto sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
            <Input value={query} onChange={e => { setQuery(e.target.value); reset(); }}
              placeholder={t('flags.search')} className="pl-9" aria-label={t('flags.search')} />
          </div>
        </div>

        {list === 'anc' && (
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
              {ancRows.slice(0, shown).map(i => (
                <tr key={i.mother_id}>
                  <td className="px-3 py-2 font-mono text-xs text-ink">{i.mother_uid ?? `#${i.mother_id}`}</td>
                  <td className="px-3 py-2 font-medium text-ink">{i.learner} <span className="text-xs text-ink-faint">ID {i.learner_id}</span>{!i.f2f && <span className="ml-1 text-xs text-ink-faint">({t('learners.notF2f')})</span>}</td>
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
                  <td className="px-3 py-2">{reasonPills(i.reasons)}</td>
                </tr>
              ))}
              {ancRows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-ink-muted">{t('flags.none')}</td></tr>}
            </tbody>
          </DataTable>
        )}

        {list === 'pnc' && (
          <DataTable>
            <thead>
              <tr>
                <Th className="text-left">{t('flags.mother')}</Th>
                <Th>{t('flags.type')}</Th>
                <Th className="text-left">{t('table.learner')}</Th>
                <Th>{t('monitors.column')}</Th>
                <Th>{t('table.block')}</Th>
                <Th>{t('flags.adopted')}</Th>
                <Th>{t('flags.dob')}</Th>
                <Th title={t('flags.gmTitle')}>{t('flags.gmChecks')}</Th>
                <Th>{t('flags.missed')}</Th>
                <Th>{t('flags.lastVisit')}</Th>
                <Th className="text-left">{t('attention.why')}</Th>
              </tr>
            </thead>
            <tbody>
              {pncRows.slice(0, shown).map(i => (
                <tr key={i.mother_id}>
                  <td className="px-3 py-2 font-mono text-xs text-ink">{i.mother_uid ?? `#${i.mother_id}`}</td>
                  <td className="px-3 py-2 text-center text-xs font-semibold text-ink">{t(`types.${i.type}`)}</td>
                  <td className="px-3 py-2 font-medium text-ink">{i.learner} <span className="text-xs text-ink-faint">ID {i.learner_id}</span></td>
                  <td className="px-3 py-2 text-center text-xs text-ink-muted">{i.monitor ?? '—'}</td>
                  <td className="px-3 py-2 text-center text-ink-muted">{i.block}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmtDate(i.adopted)}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmtDate(i.dob)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{i.visits_done}<span className="text-xs text-ink-faint"> / {i.visits_due}</span></td>
                  <td className={cn('px-3 py-2 text-center font-semibold tabular-nums', i.visits_missed >= 2 ? 'text-amber-700 dark:text-amber-500' : 'text-ink')}>{i.visits_missed}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-ink-muted">
                    {i.last_visit ? fmtDate(i.last_visit) : t('flags.never')}
                    <div className="text-xs text-ink-faint">{t('flags.daysAgo', { n: i.days_since_visit })}</div>
                  </td>
                  <td className="px-3 py-2">{reasonPills(i.reasons)}</td>
                </tr>
              ))}
              {pncRows.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-ink-muted">{t('flags.none')}</td></tr>}
            </tbody>
          </DataTable>
        )}

        {list === 'mismatch' && (
          <DataTable>
            <thead>
              <tr>
                <Th className="text-left">{t('flags.mother')}</Th>
                <Th className="text-left">{t('table.learner')}</Th>
                <Th>{t('monitors.column')}</Th>
                <Th>{t('table.block')}</Th>
                <Th>{t('flags.adopted')}</Th>
                <Th>{t('flags.declared')}</Th>
                <Th>{t('flags.computed')}</Th>
              </tr>
            </thead>
            <tbody>
              {mismatchRows.slice(0, shown).map(i => (
                <tr key={i.mother_id}>
                  <td className="px-3 py-2 font-mono text-xs text-ink">{i.mother_uid ?? `#${i.mother_id}`}</td>
                  <td className="px-3 py-2 font-medium text-ink">{i.learner} <span className="text-xs text-ink-faint">ID {i.learner_id}</span></td>
                  <td className="px-3 py-2 text-center text-xs text-ink-muted">{i.monitor ?? '—'}</td>
                  <td className="px-3 py-2 text-center text-ink-muted">{i.block}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmtDate(i.adopted)}</td>
                  <td className="px-3 py-2 text-center">{t(`types.${i.declared}`)}</td>
                  <td className="px-3 py-2 text-center font-semibold text-error-600">{t(`types.${i.computed}`)}</td>
                </tr>
              ))}
              {mismatchRows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">{t('flags.noMismatch')}</td></tr>}
            </tbody>
          </DataTable>
        )}
        {more(count)}
      </Section>
    </div>
  );
};

export default MasdFlags;
