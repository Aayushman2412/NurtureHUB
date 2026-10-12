import React from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';
import { ACTIVITY_KEYS, type ActivityKey, type MasdReport, type Targets } from '../../api/masd';
import { Section } from '../results/InsightParts';
import { DataTable, Th } from './MasdCharts';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const NURSE_KEYS: ActivityKey[] = ['gm', 'bf'];
const REST_KEYS: (keyof Targets)[] = ['anc', 'pnc_lt5', 'pnc_ge5'];

/**
 * The baseline a reader starts the dashboard from (reviews of 3 and 6 Oct
 * 2026): for each tranche, how the days it has been followed up are counted —
 * days since it opened, less its buffer, rounded down to a 15-day step of the
 * LAP table — the adoptions it asked of the rest of the learners (ANC, PNC
 * <5M, PNC ≥5M) and of Staff Nurses (PNC <5M only), and the activities that
 * should have been done per learner by the report date, form by form.
 */
const MasdBaseline: React.FC<{ report: MasdReport; className?: string }> = ({ report, className }) => {
  const { t } = useTranslation('masd');
  const cal = report.calendar;
  const trs = cal.tranches;
  if (!trs.length) return null;
  const sum = (pick: (i: number) => number) => trs.reduce((a, _, i) => a + pick(i), 0);
  const asked = (k: keyof Targets) => sum(i => trs[i].added[k]);
  const rol = (k: ActivityKey) => sum(i => trs[i].community.forms[k] ?? 0);
  const sn = (k: ActivityKey) => sum(i => trs[i].nurse.forms[k] ?? 0);
  const grp = 'border-l-2 border-border-strong';
  const groupHead = `${grp} px-3 pt-2 text-center text-xs font-bold uppercase tracking-wide text-ink`;
  const cell = 'px-2 py-2.5 text-center text-base tabular-nums text-ink';
  const date = fmtDate(report.as_of);

  return (
    <Section
      className={className}
      icon={<ClipboardList />}
      title={t('baseline.title')}
      subtitle={t('baseline.sub', { date })}
    >
      <DataTable>
        <thead>
          <tr>
            <Th className="text-left" />
            <th colSpan={4} className={groupHead}>{t('baseline.fuGroup', { date })}</th>
            <th colSpan={3} className={groupHead}>{t('baseline.askedRol')}</th>
            <th colSpan={1} className={groupHead}>{t('baseline.askedSn')}</th>
            <th colSpan={6} className={groupHead}>{t('baseline.rol', { date })}</th>
            <th colSpan={3} className={groupHead}>{t('baseline.sn', { date })}</th>
          </tr>
          <tr>
            <Th className="text-left">{t('baseline.tranche')}</Th>
            <Th className={`${grp} px-2`} title={t('baseline.sinceOpenedTitle')}>{t('baseline.sinceOpened')}</Th>
            <Th className="px-2" title={t('baseline.bufferTitle')}>{t('baseline.buffer')}</Th>
            <Th className="px-2" title={t('baseline.afterBufferTitle')}>{t('baseline.afterBuffer')}</Th>
            <Th className="px-2" title={t('baseline.consideredTitle')}>{t('baseline.considered')}</Th>
            {REST_KEYS.map((k, i) => <Th key={k} className={`px-2 ${i === 0 ? grp : ''}`}>{t(`baseline.target.${k}`)}</Th>)}
            <Th className={`px-2 ${grp}`}>{t('baseline.target.pnc_lt5')}</Th>
            {ACTIVITY_KEYS.map((k, i) => <Th key={k} className={`px-2 ${i === 0 ? grp : ''}`} title={t(`activities.${k}`)}>{t(`baseline.code.${k}`)}</Th>)}
            <Th className="px-2">{t('baseline.total')}</Th>
            {NURSE_KEYS.map((k, i) => <Th key={k} className={`px-2 ${i === 0 ? grp : ''}`} title={t(`activities.${k}`)}>{t(`baseline.code.${k}`)}</Th>)}
            <Th className="px-2">{t('baseline.total')}</Th>
          </tr>
        </thead>
        <tbody>
          {trs.map(tr => {
            const opened = tr.opened ?? tr.from;
            const since = opened && report.as_of >= opened ? daysBetween(opened, report.as_of) : null;
            return (
              <tr key={tr.step}>
                <td className="px-3 py-2.5">
                  <div className="whitespace-nowrap font-semibold text-ink">{t('expected.tranche', { n: tr.step })}</div>
                  <div className="whitespace-nowrap text-xs text-ink-muted">{t('baseline.openedOn', { date: fmtDate(tr.opened) })}</div>
                </td>
                <td className={`${grp} ${cell}`}>{since == null ? <span className="text-ink-muted">{t('baseline.notOpen')}</span> : since}</td>
                <td className={cell}>{tr.buffer}</td>
                <td className={cell} title={tr.clock_from ? t('baseline.clockFrom', { date: fmtDate(tr.clock_from) }) : undefined}>
                  {tr.fu_raw ?? '—'}
                </td>
                <td className={`${cell} font-bold`}>{tr.fu_days ?? '—'}</td>
                {REST_KEYS.map((k, i) => (
                  <td key={k} className={`${i === 0 ? grp : ''} ${cell}`}>{tr.added[k] ? `+${tr.added[k]}` : '·'}</td>
                ))}
                <td className={`${grp} ${cell}`}>{tr.added.nurse ? `+${tr.added.nurse}` : '·'}</td>
                {ACTIVITY_KEYS.map((k, i) => (
                  <td key={k} className={`${i === 0 ? grp : ''} ${cell}`}>{tr.community.forms[k] || '·'}</td>
                ))}
                <td className={`${cell} font-bold`}>{tr.community.total}</td>
                {NURSE_KEYS.map((k, i) => (
                  <td key={k} className={`${i === 0 ? grp : ''} ${cell}`}>{tr.nurse.forms[k] || '·'}</td>
                ))}
                <td className={`${cell} font-bold`}>{tr.nurse.total}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border-strong bg-coral-50/60 dark:bg-coral-500/10">
            <td className="px-3 py-2.5 font-bold text-ink" colSpan={5}>{t('baseline.totalRow', { date })}</td>
            {REST_KEYS.map((k, i) => (
              <td key={k} className={`${i === 0 ? grp : ''} ${cell} font-bold`}>{asked(k)}</td>
            ))}
            <td className={`${grp} ${cell} font-bold`}>{asked('nurse')}</td>
            {ACTIVITY_KEYS.map((k, i) => (
              <td key={k} className={`${i === 0 ? grp : ''} ${cell} font-bold`}>{rol(k)}</td>
            ))}
            <td className="px-2 py-2.5 text-center text-lg font-extrabold tabular-nums text-coral-700 dark:text-coral-300">
              {sum(i => trs[i].community.total)}
            </td>
            {NURSE_KEYS.map((k, i) => (
              <td key={k} className={`${i === 0 ? grp : ''} ${cell} font-bold`}>{sn(k)}</td>
            ))}
            <td className="px-2 py-2.5 text-center text-lg font-extrabold tabular-nums text-coral-700 dark:text-coral-300">
              {sum(i => trs[i].nurse.total)}
            </td>
          </tr>
        </tbody>
      </DataTable>
      <p className="mt-3 text-sm text-ink">{t('baseline.howDays', { step: cal.step_days ?? 15 })}</p>
      <p className="mt-1 text-sm text-ink-muted">{t('baseline.note')}</p>
    </Section>
  );
};

export default MasdBaseline;
