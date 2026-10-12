import React from 'react';
import { useTranslation } from 'react-i18next';
import { UserCheck } from 'lucide-react';
import type { MasdReport } from '../../api/masd';
import { DataTable, RateCell, Th } from './MasdCharts';

/**
 * Batch monitors (review of 5 Oct 2026): each monitor and the learners they
 * answer for — "these many of yours are doing well; these two or three need a
 * call" — so the programme team chases the monitors, not every learner.
 */
const MasdMonitors: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const data = report.batch_monitors;
  if (!data || data.monitors.length === 0) return null;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 font-display text-base font-bold text-ink">
          <UserCheck className="size-5 text-primary-ink" />
          {t('monitors.title', { count: data.monitors.length })}
        </h3>
        {data.f2f_without_monitor > 0 && (
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {t('monitors.without', { count: data.f2f_without_monitor })}
          </span>
        )}
      </div>
      <p className="text-sm text-ink">{t('monitors.explain')}</p>
      <DataTable>
        <thead>
          <tr>
            <Th className="text-left">{t('monitors.monitor')}</Th>
            <Th>{t('monitors.learners')}</Th>
            <Th>{t('monitors.onTrack')}</Th>
            <Th>{t('monitors.needCall')}</Th>
            <Th>{t('learners.own')}</Th>
            <Th className="text-left">{t('monitors.whoToCall')}</Th>
          </tr>
        </thead>
        <tbody>
          {data.monitors.map(m => (
            <tr key={m.id}>
              <td className="px-3 py-2">
                <div className="font-semibold text-ink">{m.name}</div>
                <div className="text-xs text-ink-muted"><span className="font-semibold text-ink">ID {m.id}</span> · {m.role_group} · {m.block}</div>
              </td>
              <td className="px-3 py-2 text-center font-semibold tabular-nums text-ink">{m.learners}</td>
              <td className="px-3 py-2 text-center tabular-nums text-success-700 dark:text-success-300">{m.on_track}</td>
              <td className="px-3 py-2 text-center font-bold tabular-nums text-error-700 dark:text-error-300">{m.need_call || '—'}</td>
              <RateCell value={m.own_pct} />
              <td className="px-3 py-2 text-sm text-ink">
                {m.calls.length === 0 ? <span className="text-ink-muted">{m.learners ? t('monitors.allOnTrack') : t('monitors.noLearners')}</span> : (
                  <ul className="space-y-0.5">
                    {m.calls.map(c => (
                      <li key={c.id}>
                        <strong>{c.name}</strong> <span className="text-xs text-ink-muted">ID {c.id}</span>
                        {' — '}{c.reasons.map(r => t(`attention.reasons.${r}`)).join(', ')}
                        {c.nil_days != null && <span className="text-xs text-ink-muted"> · {t('monitors.quietDays', { n: c.nil_days })}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
};

export default MasdMonitors;
