import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import {
  getMasdSettings, INDICATORS, saveMasdSettings,
  type Benchmarks, type BenchValues, type ExpectedFormsTable, type Indicator, type MasdBatch, type Targets, type TargetStep,
} from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { Button, DateInput, Field, Input, Modal, NumberInput } from '../ui';
import { calcTranches, defaultBuffer, sumForms } from '../../lib/masdTranches';

/** NFHS columns the analysts fill: two age bands and, for districts, under-5. */
type BenchCol = 'lt6' | 'm6_11' | 'under5';
const BENCH_COLS: BenchCol[] = ['lt6', 'm6_11', 'under5'];
type BenchKey = Indicator | 'n';
const BENCH_KEYS: BenchKey[] = [...INDICATORS, 'n'];
type Grid = Record<BenchCol, Record<BenchKey, string>>;
const emptyCol = () => Object.fromEntries(BENCH_KEYS.map(k => [k, ''])) as Record<BenchKey, string>;
const emptyGrid = (): Grid => ({ lt6: emptyCol(), m6_11: emptyCol(), under5: emptyCol() });
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const ORDERED: Indicator[] = ['stunting', 'severe_stunting', 'underweight', 'severe_underweight', 'wasting', 'sam'];

const TARGET_KEYS = ['anc', 'pnc_lt5', 'pnc_ge5', 'nurse'] as const;
/** One tranche as the analyst types it: the adoptions it ADDS. */
interface Row { from: string; buffer: number; add: Targets }
const today = () => new Date().toISOString().slice(0, 10);

/** Stored steps are cumulative; the editor shows what each one adds. */
function toRows(steps: TargetStep[]): Row[] {
  const sorted = [...steps].sort((a, b) => ((a.from ?? '') < (b.from ?? '') ? -1 : 1));
  let prev: Targets = { anc: 0, pnc_lt5: 0, pnc_ge5: 0, nurse: 0 };
  return sorted.map((s, i) => {
    const add = {
      anc: Math.max(0, s.anc - prev.anc), pnc_lt5: Math.max(0, s.pnc_lt5 - prev.pnc_lt5),
      pnc_ge5: Math.max(0, s.pnc_ge5 - prev.pnc_ge5), nurse: Math.max(0, s.nurse - prev.nurse),
    };
    prev = { anc: s.anc, pnc_lt5: s.pnc_lt5, pnc_ge5: s.pnc_ge5, nurse: s.nurse };
    return { from: s.from ?? '', buffer: s.buffer ?? defaultBuffer(i), add };
  });
}

function toSteps(rows: Row[]): TargetStep[] {
  const sorted = [...rows].filter(r => r.from).sort((a, b) => (a.from < b.from ? -1 : 1));
  const run: Targets = { anc: 0, pnc_lt5: 0, pnc_ge5: 0, nurse: 0 };
  return sorted.map(r => {
    for (const k of TARGET_KEYS) run[k] += r.add[k];
    return { from: r.from, ...run, buffer: r.buffer };
  });
}

/**
 * The project's programme settings — the inputs the dashboard is read
 * against: the F2F training batches, the tranches of adoption (what each asks
 * for, from when, after what buffer — with each tranche's follow-up and the
 * forms it should have produced worked out as you type), the training date for
 * learners not in a batch, and the NFHS benchmarks.
 */
const MasdSettingsModal: React.FC<{
  project: string | null; open: boolean; onClose: () => void; onSaved: () => void;
  table?: ExpectedFormsTable; asOf?: string;
}> = ({ project, open, onClose, onSaved, table, asOf }) => {
  const { t } = useTranslation('masd');
  const { showToast } = useToast();
  const [training, setTraining] = useState('');
  const [label, setLabel] = useState('');
  const [grid, setGrid] = useState<Grid>(emptyGrid());
  const [trend, setTrend] = useState<Benchmarks['district_trend']>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [batches, setBatches] = useState<MasdBatch[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [targetsDefault, setTargetsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focusBatch, setFocusBatch] = useState<number | null>(null);
  const batchRefs = useRef<(HTMLInputElement | null)[]>([]);
  const reportDate = asOf || today();

  useEffect(() => {
    if (!open || !project) return;
    setError('');
    getMasdSettings(project).then(s => {
      setTraining(s.training_date ?? '');
      setLabel(s.benchmarks?.label ?? '');
      const g = emptyGrid();
      const cols: Record<BenchCol, BenchValues | null | undefined> = {
        lt6: s.benchmarks?.age_bands?.lt6, m6_11: s.benchmarks?.age_bands?.m6_11, under5: s.benchmarks?.under5,
      };
      for (const c of BENCH_COLS) for (const k of BENCH_KEYS) {
        const v = cols[c]?.[k];
        g[c][k] = v == null ? '' : String(v);
      }
      setGrid(g);
      setTrend(s.benchmarks?.district_trend ?? null);
      setIsDefault(s.benchmarks_are_default);
      setBatches(s.batches);
      setRows(toRows(s.targets));
      setTargetsDefault(s.targets_are_default);
    }).catch(() => setError(t('settings.loadFailed')));
  }, [open, project, t]);

  // A new batch row: in view, its name selected, ready to type over.
  useEffect(() => {
    if (focusBatch == null) return;
    const el = batchRefs.current[focusBatch];
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus();
      el.select();
    }
    setFocusBatch(null);
  }, [focusBatch, batches.length]);

  const steps = useMemo(() => toSteps(rows), [rows]);
  const calc = useMemo(() => calcTranches(steps, table, reportDate), [steps, table, reportDate]);
  const calcByFrom = useMemo(() => new Map(calc.map(c => [c.from, c])), [calc]);
  const open_ = calc.filter(c => c.fu != null);
  const totalCommunity = sumForms(open_.map(c => c.community)).total;
  const totalNurse = sumForms(open_.map(c => c.nurse)).total;
  const askedTotal = (k: keyof Targets) => open_.reduce((a, c) => a + c.added[k], 0);

  const patchBatch = (i: number, patch: Partial<MasdBatch>) =>
    setBatches(list => list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const patchRow = (i: number, patch: Partial<Row>) =>
    setRows(list => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const patchAdd = (i: number, k: keyof Targets, v: number) =>
    setRows(list => list.map((r, j) => (j === i ? { ...r, add: { ...r.add, [k]: v } } : r)));

  const addBatch = () => {
    setBatches(list => {
      const last = list[list.length - 1];
      return [...list, {
        id: null, name: t('settings.batchDefault', { n: list.length + 1 }),
        end_date: last?.end_date || training || today(),
      }];
    });
    setFocusBatch(batches.length);
  };

  const save = async () => {
    if (!project) return;
    const values = BENCH_COLS.flatMap(c => INDICATORS.map(i => num(grid[c][i])));
    if (values.some(v => v != null && (Number.isNaN(v) || v < 0 || v > 100))) {
      setError(t('settings.pctError'));
      return;
    }
    const ns = BENCH_COLS.map(c => num(grid[c].n));
    if (ns.some(v => v != null && (Number.isNaN(v) || v < 0 || !Number.isInteger(v)))) {
      setError(t('settings.nError'));
      return;
    }
    const names = batches.map(b => b.name.trim().toLowerCase());
    if (batches.some(b => !b.name.trim() || !b.end_date) || new Set(names).size !== names.length) {
      setError(t('settings.batchError'));
      return;
    }
    const days = rows.map(r => r.from);
    if (rows.some(r => !r.from) || new Set(days).size !== days.length) {
      setError(t('settings.targetError'));
      return;
    }
    const col = (c: BenchCol): BenchValues | null => {
      const out: BenchValues = {};
      let any = false;
      for (const k of BENCH_KEYS) {
        const v = num(grid[c][k]);
        if (v != null) any = true;
        (out as Record<string, number | null>)[k] = v;
      }
      return any ? out : null;
    };
    const hasBench = !!label.trim() || BENCH_COLS.some(c => col(c));
    const ageBands: Benchmarks['age_bands'] = {};
    for (const b of ['lt6', 'm6_11'] as const) {
      const v = col(b);
      if (v) ageBands[b] = v;
    }
    const benchmarks: Benchmarks | null = hasBench ? {
      label: label.trim(), age_bands: ageBands, under5: col('under5'), district_trend: trend ?? null,
    } : null;
    // Tranche 2 is the second step's date: kept in step for the calendar the
    // backend still holds, never asked for twice.
    const second = steps[1]?.from ?? null;
    setSaving(true);
    setError('');
    try {
      await saveMasdSettings(project, {
        training_date: training || null,
        tranche2_start: second && (!training || second > training) ? second : null,
        benchmarks,
        targets: steps,
        batches: batches.map(b => ({ id: b.id, name: b.name.trim(), end_date: b.end_date })),
      });
      showToast(t('settings.saved'), 'success');
      onSaved();
      onClose();
    } catch {
      setError(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const small = 'text-xs font-semibold text-ink-muted';
  const lt12 = (k: Indicator) => {
    const p1 = num(grid.lt6[k]), n1 = num(grid.lt6.n), p2 = num(grid.m6_11[k]), n2 = num(grid.m6_11.n);
    if (p1 == null || p2 == null || n1 == null || n2 == null || n1 + n2 <= 0) return '—';
    return `${((p1 * n1 + p2 * n2) / (n1 + n2)).toFixed(1)}`;
  };
  const nTotal = () => {
    const n1 = num(grid.lt6.n), n2 = num(grid.m6_11.n);
    return n1 != null && n2 != null ? String(n1 + n2) : '—';
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={t('settings.title')}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {error && <p className="mr-auto text-sm font-semibold text-error-600" role="alert">{error}</p>}
          <Button variant="ghost" onClick={onClose}>{t('settings.cancel')}</Button>
          <Button onClick={save} loading={saving}>{t('settings.save')}</Button>
        </div>
      }
    >
      <div className="space-y-8">
        <section>
          <h3 className="font-display text-base font-bold text-ink">{t('settings.targets')}</h3>
          <p className="mb-3 text-sm text-ink-muted">
            {targetsDefault ? t('settings.targetsDefault') : t('settings.targetsHint')}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr>
                  <th className={`pb-1 text-left ${small}`} colSpan={3} />
                  <th className={`pb-1 text-center ${small}`} colSpan={4}>{t('settings.askedInTranche')}</th>
                  <th className={`pb-1 text-center ${small}`} colSpan={3}>{t('settings.autoCalc', { date: reportDate })}</th>
                  <th />
                </tr>
                <tr>
                  <th className={`pb-2 text-left ${small}`}>#</th>
                  <th className={`pb-2 text-left ${small}`}>{t('settings.from')}</th>
                  <th className={`pb-2 text-center ${small}`}>{t('settings.buffer')}</th>
                  {TARGET_KEYS.map(k => <th key={k} className={`pb-2 text-center ${small}`}>+ {t(`settings.target.${k}`)}</th>)}
                  <th className={`pb-2 text-center ${small}`} title={t('expected.fuTitle')}>{t('settings.fuNow')}</th>
                  <th className={`pb-2 text-center ${small}`}>{t('settings.expRol')}</th>
                  <th className={`pb-2 text-center ${small}`}>{t('settings.expSn')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = r.from ? calcByFrom.get(r.from) : undefined;
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1.5 pr-2 font-semibold text-ink-muted">{i + 1}</td>
                      <td className="min-w-[10.5rem] py-1.5 pr-2"><DateInput value={r.from} onChange={v => patchRow(i, { from: v })} /></td>
                      <td className="w-20 px-1 py-1.5">
                        <NumberInput value={r.buffer} fallback={defaultBuffer(i)} min={0} max={60} className="text-center"
                          title={t('settings.bufferDefault', { n: defaultBuffer(i) })}
                          aria-label={`${t('settings.buffer')} ${r.from}`}
                          onChange={v => patchRow(i, { buffer: v })} />
                      </td>
                      {TARGET_KEYS.map(k => (
                        <td key={k} className="w-20 px-1 py-1.5">
                          <NumberInput value={r.add[k]} fallback={0} min={0} max={50} className="text-center"
                            aria-label={`${t(`settings.target.${k}`)} ${r.from}`}
                            onChange={v => patchAdd(i, k, v)} />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center tabular-nums">
                        {c?.fu == null ? <span className="text-ink-muted">{t('settings.notOpen')}</span> : (
                          <>
                            <div className="font-bold text-ink">{t('baseline.days', { n: c.fu })}</div>
                            <div className="text-xs text-ink-muted">{t('baseline.fuRaw', { n: c.fuRaw ?? 0 })}</div>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center text-base font-bold tabular-nums text-ink">{c?.fu != null ? c.community.total : '—'}</td>
                      <td className="px-2 py-1.5 text-center text-base font-bold tabular-nums text-ink">{c?.fu != null ? c.nurse.total : '—'}</td>
                      <td className="py-1.5 pl-1">
                        <Button variant="ghost" size="sm" aria-label={t('settings.remove')} title={t('settings.remove')}
                          onClick={() => setRows(list => list.filter((_, j) => j !== i))}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-border-strong bg-coral-50/60 dark:bg-coral-500/10">
                  <td className="py-2 pl-1 pr-2 font-bold text-ink" colSpan={3}>{t('settings.totalAsOf', { date: reportDate })}</td>
                  {TARGET_KEYS.map(k => (
                    <td key={k} className="px-1 py-2 text-center text-base font-bold tabular-nums text-ink">{askedTotal(k)}</td>
                  ))}
                  <td />
                  <td className="px-2 py-2 text-center text-lg font-extrabold tabular-nums text-coral-700 dark:text-coral-300">{totalCommunity}</td>
                  <td className="px-2 py-2 text-center text-lg font-extrabold tabular-nums text-coral-700 dark:text-coral-300">{totalNurse}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" className="mt-3" iconLeft={<Plus className="size-4" />}
            onClick={() => setRows(list => [...list, {
              from: '', buffer: defaultBuffer(list.length),
              add: { anc: 1, pnc_lt5: 1, pnc_ge5: 1, nurse: 3 },
            }])}>
            {t('settings.addStep')}
          </Button>
        </section>

        <section>
          <h3 className="font-display text-base font-bold text-ink">{t('settings.batches')}</h3>
          <p className="mb-3 text-sm text-ink-muted">{t('settings.batchesHint')}</p>
          {batches.length > 0 && (
            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_11rem_5rem_2.5rem] gap-2 sm:grid">
                <span className={small}>{t('settings.batchName')}</span>
                <span className={small}>{t('settings.batchEnd')}</span>
                <span className={small}>{t('settings.batchLearners')}</span>
                <span />
              </div>
              {batches.map((b, i) => (
                <div key={b.id ?? `new-${i}`} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_11rem_5rem_2.5rem] [&>*]:min-w-0">
                  <Input ref={el => { batchRefs.current[i] = el; }} value={b.name}
                    onChange={e => patchBatch(i, { name: e.target.value })} maxLength={80}
                    aria-label={t('settings.batchName')} />
                  <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                    <DateInput value={b.end_date} onChange={v => patchBatch(i, { end_date: v })} />
                  </div>
                  <span className="hidden text-center text-sm tabular-nums text-ink-muted sm:block">{b.learners ?? 0}</span>
                  <Button variant="ghost" size="sm" aria-label={t('settings.remove')} title={t('settings.remove')}
                    onClick={() => setBatches(list => list.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" className="mt-3" iconLeft={<Plus className="size-4" />} onClick={addBatch}>
            {t('settings.addBatch')}
          </Button>
        </section>

        <section>
          <h3 className="font-display text-base font-bold text-ink">{t('settings.calendar')}</h3>
          <p className="mb-3 text-sm text-ink-muted">{t('settings.calendarHint')}</p>
          <div className="max-w-xs">
            <Field label={t('settings.trainingNoBatch')}><DateInput value={training} onChange={setTraining} /></Field>
          </div>
        </section>

        <section>
          <h3 className="font-display text-base font-bold text-ink">{t('settings.benchmarks')}</h3>
          <p className="mb-3 text-sm text-ink-muted">{isDefault ? t('settings.defaultBench') : t('settings.benchHint')}</p>
          <div className="max-w-md">
            <Field label={t('settings.benchLabel')}>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="NFHS-5 Maharashtra" maxLength={120} />
            </Field>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr>
                  <th className={`pb-2 text-left ${small}`}>{t('outcomes.indicator')}</th>
                  <th className={`pb-2 text-center ${small}`}>{t('bands.lt6')} (%)</th>
                  <th className={`pb-2 text-center ${small}`}>{t('bands.m6_11')} (%)</th>
                  <th className={`pb-2 text-center ${small}`} title={t('outcomes.lt12Title')}>{t('settings.lt12')}</th>
                  <th className={`pb-2 text-center ${small}`}>{t('settings.under5')} (%)</th>
                </tr>
              </thead>
              <tbody>
                {[...ORDERED, 'n' as const].map(k => (
                  <tr key={k} className={k === 'n' ? 'border-t-2 border-border-strong' : undefined}>
                    <td className={`py-1.5 pr-3 ${k === 'n' ? 'font-semibold text-ink' : k.startsWith('severe') || k === 'sam' ? 'pl-5 text-ink-muted' : 'font-medium text-ink'}`}>
                      {k === 'n' ? t('settings.sampleSize') : t(`indicators.${k}`)}
                    </td>
                    {(['lt6', 'm6_11'] as const).map(c => (
                      <td key={c} className="px-2 py-1.5">
                        <Input
                          inputMode={k === 'n' ? 'numeric' : 'decimal'}
                          value={grid[c][k]}
                          onChange={e => setGrid(g => ({ ...g, [c]: { ...g[c], [k]: e.target.value } }))}
                          aria-label={`${k === 'n' ? t('settings.sampleSize') : t(`indicators.${k}`)} ${t(`bands.${c}`)}`}
                          className="text-center"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-ink">{k === 'n' ? nTotal() : lt12(k)}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        inputMode={k === 'n' ? 'numeric' : 'decimal'}
                        value={grid.under5[k]}
                        onChange={e => setGrid(g => ({ ...g, under5: { ...g.under5, [k]: e.target.value } }))}
                        aria-label={`${k === 'n' ? t('settings.sampleSize') : t(`indicators.${k}`)} ${t('settings.under5')}`}
                        className="text-center"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-ink-muted">{t('settings.lt12Hint')}</p>
          {trend?.rounds?.length ? (
            <p className="mt-3 text-sm text-ink-muted">{t('settings.trendKept', { label: trend.label, rounds: trend.rounds.join(', ') })}</p>
          ) : null}
        </section>
      </div>
    </Modal>
  );
};

export default MasdSettingsModal;
