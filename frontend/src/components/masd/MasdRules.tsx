import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Baby, BookOpen, CalendarDays, ClipboardCheck, Pencil, RotateCcw, Sigma, Table2 } from 'lucide-react';
import {
  getExpectedForms, resetExpectedForms, saveExpectedForms,
  type ExpectedFormsTable, type MasdReport, type TableRowType,
} from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui';
import { Section } from '../results/InsightParts';
import { cn } from '../../utils/cn';
import { DataTable, Th } from './MasdCharts';

const ROW_LABEL: Record<TableRowType, string> = {
  anc: 'types.anc', pnc_lt5: 'types.pnc_lt5', pnc_ge5: 'types.pnc_ge5', nurse_lt5: 'rules.nurseRow',
};
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** The programme rules the report applies, straight from the backend — with
 * the expected-forms table editable in place (e.g. to load the analysts'
 * revised LAP sheet); every project's expected activity follows it. */
const MasdRules: React.FC<{ report: MasdReport; onChanged: () => void }> = ({ report, onChanged }) => {
  const { t } = useTranslation('masd');
  const { showToast } = useToast();
  const r = report.rules;
  const e = r.expected;
  const cal = report.calendar;
  const [draft, setDraft] = useState<ExpectedFormsTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const table = draft ?? e.table;
  const stepNow = cal.targets.step;

  const edit = async () => {
    setError('');
    try {
      const state = await getExpectedForms();
      setDraft(JSON.parse(JSON.stringify(state.table)) as ExpectedFormsTable);
    } catch {
      showToast(t('rules.tableLoadFailed'), 'error');
    }
  };
  const setCell = (row: TableRowType, key: string, i: number, raw: string) => {
    const v = raw.trim() === '' ? 0 : Math.max(0, Math.min(999, Math.round(Number(raw) || 0)));
    setDraft(d => {
      if (!d) return d;
      const next = JSON.parse(JSON.stringify(d)) as ExpectedFormsTable;
      (next.rows[row][key as keyof (typeof next.rows)[TableRowType]] as number[])[i] = v;
      return next;
    });
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      await saveExpectedForms(draft);
      setDraft(null);
      showToast(t('rules.tableSaved'), 'success');
      onChanged();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('rules.tableSaveFailed'));
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await resetExpectedForms();
      setDraft(null);
      showToast(t('rules.tableReset'), 'success');
      onChanged();
    } catch {
      showToast(t('rules.tableSaveFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Section icon={<CalendarDays />} title={t('rules.methodTitle')} subtitle={t('rules.methodSub')}>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
          <li>{t('rules.method1', { buffer: e.buffer_days })}</li>
          <li>{t('rules.method2', { step: e.step_days, max: e.max_days })}</li>
          <li>{t('rules.method3')}</li>
          <li>{t('rules.method4')}</li>
        </ol>
        <h4 className="mb-2 mt-5 text-sm font-semibold text-ink">
          {t('rules.targetsTitle')}{cal.targets.is_default && <span className="ml-2 text-xs font-normal text-ink-faint">{t('rules.targetsDefault')}</span>}
        </h4>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{t('settings.from')}</Th>
              {(['anc', 'pnc_lt5', 'pnc_ge5', 'nurse'] as const).map(k => <Th key={k}>{t(`settings.target.${k}`)}</Th>)}
            </tr>
          </thead>
          <tbody>
            {r.targets.map((s, i) => (
              <tr key={i} className={cn(stepNow === i + 1 && 'bg-coral-50/60 font-semibold dark:bg-coral-500/10')}>
                <td className="px-3 py-2">{fmtDate(s.from)}{stepNow === i + 1 && <span className="ml-2 text-xs text-coral-600">{t('rules.inForce')}</span>}</td>
                <td className="px-3 py-2 text-center tabular-nums">{s.anc}</td>
                <td className="px-3 py-2 text-center tabular-nums">{s.pnc_lt5}</td>
                <td className="px-3 py-2 text-center tabular-nums">{s.pnc_ge5}</td>
                <td className="px-3 py-2 text-center tabular-nums">{s.nurse}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>

      <Section
        icon={<Table2 />}
        title={t('rules.tableTitle')}
        subtitle={e.table_is_default && !draft ? t('rules.tableDefault') : t('rules.tableSub')}
        actions={draft ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setError(''); }}>{t('settings.cancel')}</Button>
            <Button size="sm" loading={busy} onClick={save}>{t('settings.save')}</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {!e.table_is_default && (
              <Button variant="ghost" size="sm" iconLeft={<RotateCcw className="size-4" />} loading={busy} onClick={reset}>
                {t('rules.tableResetButton')}
              </Button>
            )}
            <Button variant="outline" size="sm" iconLeft={<Pencil className="size-4" />} onClick={edit}>{t('rules.tableEdit')}</Button>
          </div>
        )}
      >
        <DataTable>
          <thead>
            <tr>
              <Th className="sticky left-0 z-10 bg-surface-sunken text-left">{t('rules.adoptionType')}</Th>
              <Th className="text-left">{t('rules.activity')}</Th>
              {table.durations.map(d => (
                <Th key={d} className={cn(cal.fu_days === d && 'text-coral-600')}>{t('rules.days', { n: d })}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {e.rows.map(([row, key]) => (
              <tr key={`${row}-${key}`}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5 font-medium text-ink">{t(ROW_LABEL[row])}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-muted">{t(`activities.${key}`)}</td>
                {(table.rows[row][key] ?? []).map((v, i) => (
                  <td key={i} className={cn('px-1 py-1 text-center tabular-nums', cal.fu_days === table.durations[i] && 'bg-coral-50/60 dark:bg-coral-500/10')}>
                    {draft ? (
                      <input
                        inputMode="numeric"
                        value={v}
                        onChange={ev => setCell(row, key, i, ev.target.value)}
                        aria-label={`${t(ROW_LABEL[row])} ${t(`activities.${key}`)} ${table.durations[i]}`}
                        className="w-11 rounded-md border border-border bg-surface px-1 py-0.5 text-center text-sm text-ink"
                      />
                    ) : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTable>
        {error && <p className="mt-3 text-sm font-medium text-error-600" role="alert">{error}</p>}
        <p className="mt-3 text-xs text-ink-muted">{t('rules.tableNote')}</p>
      </Section>

      <Section icon={<Baby />} title={t('rules.caseTitle')} subtitle={t('rules.caseSub')}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
          <li>{t('rules.case1', { every: e.anc_every_days, days: e.pregnancy_days })}</li>
          <li>{t('rules.case2', { bf: e.bf_until_age_days })}</li>
          <li>{t('rules.case3', { ages: e.cf_age_days.join(', '), from: e.counselling_from_age_days, first: e.cf_age_days[0] })}</li>
          <li>{t('rules.case4', { max: e.baby_max_age_days })}</li>
          <li>{t('rules.case5')}</li>
        </ul>
      </Section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Section icon={<BookOpen />} title={t('rules.termsTitle')}>
          <dl className="space-y-2.5 text-sm">
            {(['adoption', 'types', 'target', 'intensity', 'own', 'nil', 'bvavlv', 'mtfl', 'bands', 'malnutrition'] as const).map(k => (
              <div key={k}>
                <dt className="font-semibold text-ink">{t(`rules.terms.${k}.term`)}</dt>
                <dd className="text-ink-muted">{t(`rules.terms.${k}.meaning`, { days: r.five_months_days })}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section icon={<ClipboardCheck />} title={t('rules.checksTitle')} subtitle={t('rules.checksSub')}>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
            {r.exclusion_reasons.map(([key, label]) => <li key={key}>{t(`reasons.${key}`, { defaultValue: label })}</li>)}
          </ol>
          <h4 className="mt-5 flex items-center gap-2 text-sm font-semibold text-ink"><Sigma className="size-4" />{t('rules.complianceTitle')}</h4>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            <li>{t('bands.lt6')}: {t('outcomes.complianceRule', { visits: r.compliance.lt6.min_visits, days: r.compliance.lt6.min_follow_up_days })}</li>
            <li>{t('bands.m6_11')}: {t('outcomes.complianceRule', { visits: r.compliance.m6_11.min_visits, days: r.compliance.m6_11.min_follow_up_days })}</li>
          </ul>
        </Section>
      </div>
    </div>
  );
};

export default MasdRules;
