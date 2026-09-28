import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMasdSettings, INDICATORS, saveMasdSettings, type Band, type Benchmarks, type Indicator } from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { Button, DateInput, Field, Input, Modal } from '../ui';

type Grid = Record<Band, Record<Indicator, string>>;
const BANDS: Band[] = ['lt6', 'm6_11'];
const emptyGrid = (): Grid => ({
  lt6: { stunting: '', underweight: '', wasting: '' },
  m6_11: { stunting: '', underweight: '', wasting: '' },
});
const num = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * The project's programme calendar (which decides tranches, targets and the
 * ideal activities) and the NFHS benchmarks the outcomes are read against.
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
    }).catch(() => setError(t('settings.loadFailed')));
  }, [open, project, t]);

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
    const hasBench = !!label.trim() || values.some(v => v != null);
    const benchmarks: Benchmarks | null = hasBench ? {
      label: label.trim(),
      age_bands: Object.fromEntries(BANDS.map(b => [b, Object.fromEntries(INDICATORS.map(i => [i, num(grid[b][i])]))])),
      district_trend: trend ?? null,
    } : null;
    setSaving(true);
    setError('');
    try {
      await saveMasdSettings(project, { training_date: training || null, tranche2_start: tranche2 || null, benchmarks });
      showToast(t('settings.saved'), 'success');
      onSaved();
      onClose();
    } catch {
      setError(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

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
      <div className="space-y-6">
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
