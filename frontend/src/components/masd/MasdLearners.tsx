import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp, Search } from 'lucide-react';
import { setTrainerRole, type MasdLearner, type MasdReport } from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { Input } from '../ui';
import { ChipRow } from '../results/InsightParts';
import { cn } from '../../utils/cn';
import { DataTable, RateCell, Th } from './MasdCharts';
import { fmt1 } from '../../lib/masdDisplay';

type Filter = 'f2f' | 'mtfl' | 'attention' | 'outside';
type SortKey = 'name' | 'block' | 'role_group' | 'adoptions' | 'fulfilment' | 'activities' | 'intensity' | 'nil';

const sortValue = (l: MasdLearner, key: SortKey): number | string => {
  switch (key) {
    case 'name': return (l.name || '').toLowerCase();
    case 'block': return l.block.toLowerCase();
    case 'role_group': return l.role_group;
    case 'adoptions': return l.adoptions.total;
    case 'fulfilment': return l.fulfilment_pct ?? -1;
    case 'activities': return l.activities.total;
    case 'intensity': return l.intensity_pct ?? -1;
    case 'nil': return l.nil_days ?? 9999;
  }
};

const PAGE = 60;

const MasdLearners: React.FC<{ report: MasdReport; onChanged: () => void }> = ({ report, onChanged }) => {
  const { t } = useTranslation('masd');
  const { showToast } = useToast();
  const [filter, setFilter] = useState<Filter>('f2f');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'intensity', desc: false });
  const [shown, setShown] = useState(PAGE);
  const [saving, setSaving] = useState<number | null>(null);
  const attentionIds = useMemo(() => new Set(report.attention.map(a => a.id)), [report.attention]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = report.learners.filter(l => {
      if (filter === 'f2f' && !l.f2f) return false;
      if (filter === 'mtfl' && !l.mtfl) return false;
      if (filter === 'attention' && !attentionIds.has(l.id)) return false;
      if (filter === 'outside' && (l.f2f || l.adoptions.total === 0)) return false;
      return !q || [l.name, l.email, l.block, l.role_group].some(v => (v || '').toLowerCase().includes(q));
    });
    return list.sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [report.learners, filter, query, sort, attentionIds]);

  const toggleSort = (key: SortKey) => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'name' && key !== 'block' }));
  const head = (key: SortKey, label: string, left = false) => (
    <Th className={left ? 'text-left' : undefined}>
      <button type="button" onClick={() => toggleSort(key)}
        className={cn('inline-flex cursor-pointer items-center gap-1 uppercase', sort.key === key && 'text-ink')}>
        {label}<ArrowDownUp className="size-3 opacity-60" />
      </button>
    </Th>
  );

  const changeRole = async (l: MasdLearner, role: string) => {
    setSaving(l.id);
    try {
      await setTrainerRole(l.id, (role || null) as MasdLearner['trainer_role']);
      showToast(t('learners.roleSaved', { name: l.name }), 'success');
      onChanged();
    } catch {
      showToast(t('learners.roleFailed'), 'error');
    } finally {
      setSaving(null);
    }
  };

  const counts = {
    f2f: report.learners.filter(l => l.f2f).length,
    mtfl: report.learners.filter(l => l.mtfl).length,
    attention: report.attention.length,
    outside: report.learners.filter(l => !l.f2f && l.adoptions.total > 0).length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipRow
          label={t('learners.show')}
          value={filter}
          onChange={v => { setFilter(v as Filter); setShown(PAGE); }}
          items={(['f2f', 'mtfl', 'attention', 'outside'] as Filter[]).map(k => ({ key: k, label: `${t(`learners.filters.${k}`)} (${counts[k]})` }))}
        />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE); }}
            placeholder={t('learners.search')} className="pl-9" aria-label={t('learners.search')} />
        </div>
      </div>
      <p className="text-xs text-ink-muted">{t('learners.hint')}</p>

      <DataTable>
        <thead>
          <tr>
            {head('name', t('table.learner'), true)}
            {head('block', t('table.block'))}
            {head('role_group', t('table.cadre'))}
            <Th>{t('learners.mtfl')}</Th>
            {head('adoptions', t('table.adoptions'))}
            {head('fulfilment', t('table.fulfilment'))}
            {head('activities', t('learners.activities'))}
            {head('intensity', t('table.intensity'))}
            {head('nil', t('table.nilDays'))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map(l => (
            <tr key={l.id} className={cn(attentionIds.has(l.id) && 'bg-amber-50/40 dark:bg-amber-500/5')}>
              <td className="px-3 py-2">
                <div className="font-medium text-ink">{l.name}</div>
                <div className="text-xs text-ink-faint">{l.email}</div>
              </td>
              <td className="px-3 py-2 text-center text-ink-muted">{l.block}</td>
              <td className="px-3 py-2 text-center text-ink-muted">{l.role_group}</td>
              <td className="px-3 py-2 text-center">
                {l.f2f ? (
                  <select
                    value={l.trainer_role ?? ''}
                    disabled={saving === l.id}
                    onChange={e => changeRole(l, e.target.value)}
                    aria-label={t('learners.mtflFor', { name: l.name })}
                    className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
                  >
                    <option value="">—</option>
                    <option value="master_trainer">{t('learners.masterTrainer')}</option>
                    <option value="facilitator">{t('learners.facilitator')}</option>
                  </select>
                ) : <span className="text-xs text-ink-faint">{t('learners.notF2f')}</span>}
              </td>
              <td className="px-3 py-2 text-center tabular-nums" title={`ANC ${l.adoptions.anc} · <5M ${l.adoptions.pnc_lt5} · ≥5M ${l.adoptions.pnc_ge5}`}>
                <span className="font-semibold">{l.adoptions.total}</span>
                <span className="ml-1 text-xs text-ink-faint">({l.adoptions.anc}·{l.adoptions.pnc_lt5}·{l.adoptions.pnc_ge5})</span>
              </td>
              <td className="px-3 py-2 text-center tabular-nums">{fmt1(l.fulfilment_pct)}</td>
              <td className="px-3 py-2 text-center tabular-nums">{l.activities.total} <span className="text-xs text-ink-faint">/ {Math.round(l.ideal.total)}</span></td>
              <RateCell value={l.intensity_pct} />
              <td className="px-3 py-2 text-center tabular-nums">
                {l.nil_days == null ? <span className="text-ink-faint">{t('learners.never')}</span> : l.nil_days}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-ink-muted">{t('learners.none')}</td></tr>
          )}
        </tbody>
      </DataTable>
      {rows.length > shown && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setShown(s => s + PAGE)}
            className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken">
            {t('learners.more', { n: Math.min(PAGE, rows.length - shown), left: rows.length - shown })}
          </button>
        </div>
      )}
    </div>
  );
};

export default MasdLearners;
