import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, RotateCcw, TrendingDown } from 'lucide-react';
import {
  downloadFalteringXlsx, getFalteringCases,
  type FalterCondition, type FalterFilters, type FalterResponse, type FalterRow,
} from '../../api/faltering';
import { useToast } from '../../context/ToastContext';
import { getProjectSlug, onProjectChanged } from '../../lib/adminProject';
import { Button, EmptyState, PageHeader, PageLoader, SelectField } from '../../components/ui';
import { cn } from '../../utils/cn';

const SEVERE: FalterCondition[] = ['suw', 'sam', 'sst'];

const fmtZ = (z: number | null) => (z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}`);
const zTone = (z: number | null) => (z == null ? 'text-ink-faint' : z < -3 ? 'font-bold text-coral-700 dark:text-coral-300' : z < -2 ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-ink');

/**
 * Faltering cases (review of 18 Oct 2026). Sir: "a separate page where I
 * must be able to just click one or two buttons — my whole list of faltering
 * cases must be visible", with the cases filtered by severe/moderate
 * underweight, wasting and stunting or faltering, and a download that a
 * trainer can hand round: one sheet per batch monitor.
 */
const AdminFalteringPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const { showToast } = useToast();
  const [project, setProject] = useState<string>(getProjectSlug() || '');
  const [conditions, setConditions] = useState<FalterCondition[]>([]);
  const [monitor, setMonitor] = useState('');
  const [batch, setBatch] = useState('');
  const [block, setBlock] = useState('');
  const [cadre, setCadre] = useState('');
  const [department, setDepartment] = useState('');
  const [learner, setLearner] = useState('');
  const [data, setData] = useState<FalterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => onProjectChanged(() => setProject(getProjectSlug() || '')), []);

  const filters: FalterFilters = {
    district: project || undefined, conditions, monitor: monitor || undefined, batch: batch || undefined,
    block: block || undefined, cadre: cadre || undefined, department: department || undefined,
    learner_id: learner ? Number(learner) : undefined,
  };
  const key = JSON.stringify(filters);

  // Only the latest request may land: switching project while a slow "all
  // projects" load is still running must not let it overwrite the new list.
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    setLoading(true);
    getFalteringCases(JSON.parse(key))
      .then(res => { if (mine === latest.current) setData(res); })
      .catch(() => { if (mine === latest.current) showToast(t('faltering.loadFailed'), 'error'); })
      .finally(() => { if (mine === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { load(); }, [load]);

  const toggle = (c: FalterCondition) =>
    setConditions(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));
  const reset = () => {
    setConditions([]); setMonitor(''); setBatch(''); setBlock(''); setCadre(''); setDepartment(''); setLearner('');
  };
  const filtered = conditions.length > 0 || !!(monitor || batch || block || cadre || department || learner);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFalteringXlsx(filters);
    } catch {
      showToast(t('faltering.downloadFailed'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const label = (c: FalterCondition) => t(`faltering.cond.${c}`);
  const sexLabel = (r: FalterRow) => (r.child.sex === 'boys' ? t('faltering.boy') : r.child.sex === 'girls' ? t('faltering.girl') : '');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('faltering.title')}
        description={t('faltering.description')}
        actions={
          <Button onClick={download} disabled={downloading || !data?.rows.length} iconLeft={<Download className="size-4" />}>
            {downloading ? t('faltering.downloading') : t('faltering.download')}
          </Button>
        }
      />

      {/* One or two clicks: which conditions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setConditions([])}
          className={cn('cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
            conditions.length === 0 ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-ink hover:bg-surface-sunken')}
        >
          {t('faltering.all')} {data && <span className="tabular-nums opacity-80">({data.total})</span>}
        </button>
        {(data?.conditions ?? []).map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            aria-pressed={conditions.includes(c.key)}
            className={cn('cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
              conditions.includes(c.key)
                ? (SEVERE.includes(c.key) ? 'border-coral-600 bg-coral-600 text-white' : 'border-amber-600 bg-amber-600 text-white')
                : 'border-border bg-surface text-ink hover:bg-surface-sunken')}
          >
            {label(c.key)} <span className="tabular-nums opacity-80">({data?.counts[c.key] ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Whose cases */}
      {data && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <SelectField label={t('faltering.monitor')} value={monitor} onChange={setMonitor} required={false}
            placeholder={t('faltering.any')}
            options={[...data.options.monitors.map(m => ({ value: String(m.id), label: m.name ?? `#${m.id}` })),
              ...(data.options.no_monitor ? [{ value: 'none', label: t('faltering.noMonitor') }] : [])]} />
          <SelectField label={t('faltering.batch')} value={batch} onChange={setBatch} required={false}
            placeholder={t('faltering.any')} options={data.options.batches.map(b => ({ value: b, label: b }))} />
          <SelectField label={t('faltering.block')} value={block} onChange={setBlock} required={false}
            placeholder={t('faltering.any')} options={data.options.blocks.map(b => ({ value: b, label: b }))} />
          <SelectField label={t('faltering.cadre')} value={cadre} onChange={setCadre} required={false}
            placeholder={t('faltering.any')} options={data.options.cadres.map(b => ({ value: b, label: b }))} />
          {/* Department (review of 19 Oct 2026: "department is one thing we require"). */}
          <SelectField label={t('faltering.department')} value={department} onChange={setDepartment} required={false}
            placeholder={t('faltering.any')} options={(data.options.departments ?? []).map(b => ({ value: b, label: b }))} />
          <SelectField label={t('faltering.learner')} value={learner} onChange={setLearner} required={false}
            placeholder={t('faltering.any')} options={data.options.learners.map(([id, name]) => ({ value: String(id), label: `${name ?? ''} · ID ${id}` }))} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <span>
          {data && t('faltering.count', { count: data.rows.length })}
          {' · '}{t('faltering.rule')}
        </span>
        {filtered && (
          <button type="button" onClick={reset} className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-primary-ink hover:text-primary-ink-hover">
            <RotateCcw className="size-3.5" />{t('faltering.reset')}
          </button>
        )}
      </div>

      {loading && !data ? (
        <PageLoader label={t('faltering.loading')} />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState icon={<TrendingDown className="size-8" />} title={t('faltering.emptyTitle')} description={t('faltering.emptyBody')} />
      ) : (
        <div className={cn('max-h-[72vh] overflow-auto rounded-xl border border-border bg-surface', loading && 'opacity-60')}>
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-sunken text-left text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
              <tr className="[&>th]:border-b [&>th]:border-border-strong [&>th]:px-3 [&>th]:py-2">
                <th>{t('faltering.col.why')}</th>
                <th>{t('faltering.col.monitor')}</th>
                <th>{t('faltering.col.learner')}</th>
                <th>{t('faltering.col.mother')}</th>
                <th>{t('faltering.col.baby')}</th>
                <th>{t('faltering.col.last')}</th>
                <th className="text-right">{t('faltering.col.weight')}</th>
                <th className="text-center">WAZ</th>
                <th className="text-center">HAZ</th>
                <th className="text-center">WHZ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map(r => (
                <tr
                  key={r.case_id}
                  onClick={() => window.open(`/admin/growth/cases/${r.case_id}`, '_blank', 'noopener')}
                  className="cursor-pointer align-top transition-colors hover:bg-surface-sunken [&>td]:px-3 [&>td]:py-2"
                  title={t('faltering.openCase')}
                >
                  <td className="max-w-64">
                    <span className="flex flex-wrap gap-1">
                      {r.flags.map(f => (
                        <span key={f} className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold',
                          SEVERE.includes(f) ? 'bg-coral-100 text-coral-800 dark:bg-coral-500/20 dark:text-coral-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200')}>
                          {SEVERE.includes(f) && <AlertTriangle className="size-3" />}{label(f)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{r.monitor?.name ?? <span className="text-ink-faint">{t('faltering.noMonitor')}</span>}
                    {r.batch && <span className="block text-xs text-ink-muted">{r.batch}</span>}</td>
                  <td className="whitespace-nowrap"><span className="font-semibold text-ink">{r.learner.name}</span>
                    {/* ID and mobile: synthetic and real learners share names, so tell namesakes apart */}
                    <span className="block text-xs text-ink-muted">
                      {[r.learner.id != null ? t('faltering.learnerId', { id: r.learner.id }) : null, r.learner.mobile].filter(Boolean).join(' · ')}
                    </span>
                    <span className="block text-xs text-ink-muted">{[r.learner.cadre, r.learner.department, r.learner.block].filter(Boolean).join(' · ')}</span></td>
                  <td className="whitespace-nowrap">{r.mother.name}
                    <span className="block font-mono text-xs text-ink-muted">{r.mother.uid}{r.mother.village ? ` · ${r.mother.village}` : ''}</span></td>
                  <td className="whitespace-nowrap">{r.child.name ?? '—'}
                    <span className="block text-xs text-ink-muted">{[sexLabel(r), r.child.age_months != null ? t('faltering.months', { n: r.child.age_months }) : null].filter(Boolean).join(' · ')}</span></td>
                  <td className="whitespace-nowrap">{r.last_visit ?? '—'}
                    {r.days_since_visit != null && <span className="block text-xs text-ink-muted">{t('faltering.daysAgo', { count: r.days_since_visit })}</span>}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{r.weight != null ? `${r.weight} kg` : '—'}
                    {r.weight_change_g != null && (
                      <span className={cn('block text-xs', r.weight_change_g < 0 ? 'font-semibold text-coral-700 dark:text-coral-300' : 'text-ink-muted')}>
                        {r.weight_change_g > 0 ? '+' : ''}{r.weight_change_g} g
                      </span>
                    )}
                    {/* Weight-for-age percentile, the visit before → now: a
                        fall is faltering even when the weight rose a little. */}
                    {r.wfa_pct != null && (
                      <span className={cn('block text-xs', r.wfa_pct_before != null && r.wfa_pct < r.wfa_pct_before ? 'font-semibold text-coral-700 dark:text-coral-300' : 'text-ink-muted')}
                        title={t('faltering.pctTitle')}>
                        {r.wfa_pct_before != null ? `${t('faltering.pct', { n: r.wfa_pct_before })} → ${t('faltering.pct', { n: r.wfa_pct })}` : t('faltering.pct', { n: r.wfa_pct })}
                      </span>
                    )}</td>
                  <td className={cn('text-center tabular-nums', zTone(r.z.wfaz))}>{fmtZ(r.z.wfaz)}</td>
                  <td className={cn('text-center tabular-nums', zTone(r.z.hfaz))}>{fmtZ(r.z.hfaz)}</td>
                  <td className={cn('text-center tabular-nums', zTone(r.z.wfhz))}>{fmtZ(r.z.wfhz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminFalteringPage;
