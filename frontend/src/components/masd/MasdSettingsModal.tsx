import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import {
  getMasdSettings, INDICATORS, saveMasdSettings,
  type Band, type Benchmarks, type Indicator, type MasdBatch, type TargetStep,
} from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { Button, DateInput, Field, Input, Modal, NumberInput } from '../ui';

type Grid = Record<Band, Record<Indicator, string>>;
const BANDS: Band[] = ['lt6', 'm6_11'];
const TARGET_KEYS = ['anc', 'pnc_lt5', 'pnc_ge5', 'nurse'] as const;
// The buffers a tranche gets when none is set (app/masd/rules.py).
const defaultBuffer = (index: number) => (index === 0 ? 7 : 4);
const emptyGrid = (): Grid => ({
  lt6: { stunting: '', underweight: '', wasting: '' },
  m6_11: { stunting: '', underweight: '', wasting: '' },
});
const num = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * The project's programme settings: the F2F training batches (each learner's
 * follow-up starts from their own batch), the adoption targets and how they
 * rise at each review, the calendar, and the NFHS benchmarks the outcomes are
 * read against.
 */
const MasdSettingsModal: React.FC<{ project: string | null; open: boolean; onClose: () => void; onSaved: () => void }> = ({
  project, open, onClose, onSaved,
}) => {
  const { t } = useTranslation('masd');
  const { showToast } = useToast();
  const [training, setTraining] = useState('');
  const [tranche2, setTranche2] = useState('');
  const [label, setLabel] = useState('');
  const [grid, setGrid] = useState<Grid>(emptyGrid());
  const [trend, setTrend] = useState<Benchmarks['district_trend']>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [batches, setBatches] = useState<MasdBatch[]>([]);
  const [targets, setTargets] = useState<TargetStep[]>([]);
  const [targetsDefault, setTargetsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !project) return;
    setError('');
    getMasdSettings(project).then(s => {
      setTraining(s.training_date ?? '');
      setTranche2(s.tranche2_start ?? '');
      setLabel(s.benchmarks?.label ?? '');
      const g = emptyGrid();
      for (const b of BANDS) for (const i of INDICATORS) {
        const v = s.benchmarks?.age_bands?.[b]?.[i];
        g[b][i] = v == null ? '' : String(v);
      }
      setGrid(g);
      setTrend(s.benchmarks?.district_trend ?? null);
      setIsDefault(s.benchmarks_are_default);
      setBatches(s.batches);
      setTargets(s.targets.map((x, i) => ({ ...x, from: x.from ?? '', buffer: x.buffer ?? defaultBuffer(i) })));
      setTargetsDefault(s.targets_are_default);
    }).catch(() => setError(t('settings.loadFailed')));
  }, [open, project, t]);

  const patchBatch = (i: number, patch: Partial<MasdBatch>) =>
    setBatches(list => list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const patchStep = (i: number, patch: Partial<TargetStep>) =>
    setTargets(list => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async () => {
    if (!project) return;
    if (training && tranche2 && tranche2 <= training) {
      setError(t('settings.orderError'));
      return;
    }
    const values = BANDS.flatMap(b => INDICATORS.map(i => num(grid[b][i])));
    if (values.some(v => v != null && (Number.isNaN(v) || v < 0 || v > 100))) {
      setError(t('settings.pctError'));
      return;
    }
    const names = batches.map(b => b.name.trim().toLowerCase());
    if (batches.some(b => !b.name.trim() || !b.end_date) || new Set(names).size !== names.length) {
      setError(t('settings.batchError'));
      return;
    }
    const days = targets.map(s => s.from);
    if (targets.some(s => !s.from) || new Set(days).size !== days.length) {
      setError(t('settings.targetError'));
      return;
    }
    const hasBench = !!label.trim() || values.some(v => v != null);
    const benchmarks: Benchmarks | null = hasBench ? {
      label: label.trim(),
      age_bands: Object.fromEntries(BANDS.map(b => [b, Object.fromEntries(INDICATORS.map(i => [i, num(grid[b][i])]))])),
      district_trend: trend ?? null,
    } : null;
    setSaving(true);
    setError('');
    try {
      await saveMasdSettings(project, {
        training_date: training || null,
        tranche2_start: tranche2 || null,
        benchmarks,
        targets,
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
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('settings.title')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('settings.cancel')}</Button>
          <Button onClick={save} loading={saving}>{t('settings.save')}</Button>
        </div>
      }
    >
      <div className="space-y-7">
        <section>
          <h3 className="font-display text-sm font-bold text-ink">{t('settings.batches')}</h3>
          <p className="mb-3 text-xs text-ink-muted">{t('settings.batchesHint')}</p>
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
                  <Input value={b.name} onChange={e => patchBatch(i, { name: e.target.value })} maxLength={80}
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
          <Button variant="outline" size="sm" className="mt-3" iconLeft={<Plus className="size-4" />}
            onClick={() => setBatches(list => [...list, { id: null, name: t('settings.batchDefault', { n: list.length + 1 }), end_date: training || '' }])}>
            {t('settings.addBatch')}
          </Button>
        </section>

        <section>
          <h3 className="font-display text-sm font-bold text-ink">{t('settings.targets')}</h3>
          <p className="mb-3 text-xs text-ink-muted">{targetsDefault ? t('settings.targetsDefault') : t('settings.targetsHint')}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr>
                  <th className={`pb-2 text-left ${small}`}>{t('settings.from')}</th>
                  {TARGET_KEYS.map(k => <th key={k} className={`pb-2 text-center ${small}`}>{t(`settings.target.${k}`)}</th>)}
                  <th className={`pb-2 text-center ${small}`}>{t('settings.buffer')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {targets.map((s, i) => (
                  <tr key={i}>
                    <td className="min-w-[10.5rem] py-1 pr-2"><DateInput value={s.from ?? ''} onChange={v => patchStep(i, { from: v })} /></td>
                    {TARGET_KEYS.map(k => (
                      <td key={k} className="px-1 py-1">
                        <NumberInput value={s[k]} fallback={0} min={0} max={50} className="text-center"
                          aria-label={`${t(`settings.target.${k}`)} ${s.from ?? ''}`}
                          onChange={v => patchStep(i, { [k]: v } as Partial<TargetStep>)} />
                      </td>
                    ))}
                    <td className="px-1 py-1">
                      <NumberInput value={s.buffer ?? defaultBuffer(i)} fallback={defaultBuffer(i)} min={0} max={60}
                        className="text-center" title={t('settings.bufferDefault', { n: defaultBuffer(i) })}
                        aria-label={`${t('settings.buffer')} ${s.from ?? ''}`}
                        onChange={v => patchStep(i, { buffer: v })} />
                    </td>
                    <td className="py-1 pl-1">
                      <Button variant="ghost" size="sm" aria-label={t('settings.remove')} title={t('settings.remove')}
                        onClick={() => setTargets(list => list.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" className="mt-3" iconLeft={<Plus className="size-4" />}
            onClick={() => setTargets(list => {
              const last = list[list.length - 1];
              return [...list, { from: '', anc: last?.anc ?? 1, pnc_lt5: last?.pnc_lt5 ?? 1, pnc_ge5: last?.pnc_ge5 ?? 1, nurse: last?.nurse ?? 3, buffer: defaultBuffer(list.length) }];
            })}>
            {t('settings.addStep')}
          </Button>
        </section>

        <section>
          <h3 className="font-display text-sm font-bold text-ink">{t('settings.calendar')}</h3>
          <p className="mb-3 text-xs text-ink-muted">{t('settings.calendarHint')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label={t('calendar.training')}><DateInput value={training} onChange={setTraining} /></Field>
            <Field label={t('calendar.tranche2')}><DateInput value={tranche2} onChange={setTranche2} min={training || undefined} /></Field>
          </div>
        </section>
        <section>
          <h3 className="font-display text-sm font-bold text-ink">{t('settings.benchmarks')}</h3>
          <p className="mb-3 text-xs text-ink-muted">{isDefault ? t('settings.defaultBench') : t('settings.benchHint')}</p>
          <Field label={t('settings.benchLabel')}>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="NFHS-5 Maharashtra" maxLength={120} />
          </Field>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="pb-2 text-left text-xs font-semibold text-ink-muted">{t('outcomes.indicator')}</th>
                  {BANDS.map(b => <th key={b} className="pb-2 text-center text-xs font-semibold text-ink-muted">{t(`bands.${b}`)} (%)</th>)}
                </tr>
              </thead>
              <tbody>
                {INDICATORS.map(i => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 text-ink">{t(`indicators.${i}`)}</td>
                    {BANDS.map(b => (
                      <td key={b} className="px-2 py-1.5">
                        <Input
                          inputMode="decimal"
                          value={grid[b][i]}
                          onChange={e => setGrid(g => ({ ...g, [b]: { ...g[b], [i]: e.target.value } }))}
                          aria-label={`${t(`indicators.${i}`)} ${t(`bands.${b}`)}`}
                          className="text-center"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trend?.rounds?.length ? (
            <p className="mt-3 text-xs text-ink-muted">{t('settings.trendKept', { label: trend.label, rounds: trend.rounds.join(', ') })}</p>
          ) : null}
        </section>
        {error && <p className="text-sm font-medium text-error-600" role="alert">{error}</p>}
      </div>
    </Modal>
  );
};

export default MasdSettingsModal;
