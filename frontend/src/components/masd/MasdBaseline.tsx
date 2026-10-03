import React from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';
import { ACTIVITY_KEYS, type ActivityKey, type MasdReport, type Targets } from '../../api/masd';
import { Section } from '../results/InsightParts';
import { DataTable, Th } from './MasdCharts';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const NURSE_KEYS: ActivityKey[] = ['gm', 'bf'];
const ASKED_KEYS: (keyof Targets)[] = ['anc', 'pnc_lt5', 'pnc_ge5', 'nurse'];

/**
 * The baseline a reader starts the dashboard from (review of 3 Oct 2026): what
 * each learner was asked to adopt in each tranche, how long that tranche has
 * been followed up, and the forms it should have produced by now — for the
 * rest of the learners (ANC, protein, growth, breastfeeding, complementary
 * feeding) and for Staff Nurses (growth, breastfeeding) — with the totals as
 * of the report date. Everything below on the dashboard is read against it.
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

  return (
    <Section
      className={className}
      icon={<ClipboardList />}
      title={t('baseline.title')}
      subtitle={t('baseline.sub', { date: fmtDate(report.as_of) })}
    >
      <DataTable>
        <thead>
          <tr>
            <Th className="text-left" />
            <Th className={grp}>{''}</Th>
            <th colSpan={4} className={`${grp} px-3 pt-2 text-center text-xs font-bold uppercase tracking-wide text-ink`}>{t('baseline.asked')}</th>
            <th colSpan={6} className={`${grp} px-3 pt-2 text-center text-xs font-bold uppercase tracking-wide text-ink`}>{t('baseline.rol')}</th>
            <th colSpan={3} className={`${grp} px-3 pt-2 text-center text-xs font-bold uppercase tracking-wide text-ink`}>{t('baseline.sn')}</th>
          </tr>
          <tr>
            <Th className="text-left">{t('baseline.tranche')}</Th>
            <Th className={grp} title={t('expected.fuTitle')}>{t('baseline.fu')}</Th>
            {ASKED_KEYS.map((k, i) => <Th key={k} className={`px-2 ${i === 0 ? grp : ''}`}>{t(`baseline.target.${k}`)}</Th>)}
            {ACTIVITY_KEYS.map((k, i) => <Th key={k} className={`px-2 ${i === 0 ? grp : ''}`} title={t(`activities.${k}`)}>{t(`baseline.code.${k}`)}</Th>)}
            <Th className="px-2">{t('baseline.total')}</Th>
            {NURSE_KEYS.map((k, i) => <Th key={k} className={`px-2 ${i === 0 ? grp : ''}`} title={t(`activities.${k}`)}>{t(`baseline.code.${k}`)}</Th>)}
            <Th className="px-2">{t('baseline.total')}</Th>
          </tr>
        </thead>
        <tbody>
          {trs.map(tr => (
            <tr key={tr.step}>
              <td className="px-3 py-2.5">
                <div className="whitespace-nowrap font-semibold text-ink">{t('expected.tranche', { n: tr.step })}</div>
                <div className="whitespace-nowrap text-xs text-ink-muted">
                  {t('expected.openedBuffer', { date: fmtDate(tr.opened), n: tr.buffer })}
                </div>
              </td>
              <td className={`${grp} px-3 py-2.5 text-center`}>
                <div className="text-base font-bold tabular-nums text-ink">{t('baseline.days', { n: tr.fu_days ?? 0 })}</div>
                <div className="text-xs text-ink-muted">{t('baseline.fuRaw', { n: tr.fu_raw ?? 0 })}</div>
              </td>
              {ASKED_KEYS.map((k, i) => (
                <td key={k} className={`${i === 0 ? grp : ''} px-2 py-2.5 text-center text-base tabular-nums text-ink`}>
                  {tr.added[k] ? `+${tr.added[k]}` : '·'}
                </td>
              ))}
              {ACTIVITY_KEYS.map((k, i) => (
                <td key={k} className={`${i === 0 ? grp : ''} px-2 py-2.5 text-center text-base tabular-nums text-ink`}>{tr.community.forms[k] || '·'}</td>
              ))}
              <td className="px-2 py-2.5 text-center text-base font-bold tabular-nums text-ink">{tr.community.total}</td>
              {NURSE_KEYS.map((k, i) => (
                <td key={k} className={`${i === 0 ? grp : ''} px-2 py-2.5 text-center text-base tabular-nums text-ink`}>{tr.nurse.forms[k] || '·'}</td>
              ))}
              <td className="px-2 py-2.5 text-center text-base font-bold tabular-nums text-ink">{tr.nurse.total}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border-strong bg-coral-50/60 dark:bg-coral-500/10">
            <td className="px-3 py-2.5 font-bold text-ink" colSpan={2}>{t('baseline.totalRow', { date: fmtDate(report.as_of) })}</td>
            {ASKED_KEYS.map((k, i) => (
              <td key={k} className={`${i === 0 ? grp : ''} px-2 py-2.5 text-center text-base font-bold tabular-nums text-ink`}>{asked(k)}</td>
            ))}
            {ACTIVITY_KEYS.map((k, i) => (
              <td key={k} className={`${i === 0 ? grp : ''} px-2 py-2.5 text-center text-base font-bold tabular-nums text-ink`}>{rol(k)}</td>
            ))}
            <td className="px-2 py-2.5 text-center text-lg font-extrabold tabular-nums text-coral-700 dark:text-coral-300">
              {sum(i => trs[i].community.total)}
            </td>
            {NURSE_KEYS.map((k, i) => (
              <td key={k} className={`${i === 0 ? grp : ''} px-2 py-2.5 text-center text-base font-bold tabular-nums text-ink`}>{sn(k)}</td>
            ))}
            <td className="px-2 py-2.5 text-center text-lg font-extrabold tabular-nums text-coral-700 dark:text-coral-300">
              {sum(i => trs[i].nurse.total)}
            </td>
          </tr>
        </tbody>
      </DataTable>
      <p className="mt-3 text-sm text-ink-muted">{t('baseline.note')}</p>
    </Section>
  );
};

export default MasdBaseline;
