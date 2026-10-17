import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UsersRound } from 'lucide-react';
import { getMyTeam, type MyTeamRow } from '../../api/myWork';
import { Card } from '../ui';
import { cn } from '../../utils/cn';

/**
 * A batch monitor's learners and how each is doing (reviews of 6 and 17 Oct
 * 2026) — adoptions against target, forms done against due, days since they
 * last did anything — so the monitor knows whom to call first. Only the
 * learners given to this monitor; counts only, no mother is named.
 */
const MyTeamCard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const [rows, setRows] = useState<MyTeamRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    getMyTeam().then(r => { if (alive) setRows(r.learners); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <Card className="p-4 sm:p-6">
      <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <UsersRound className="size-5 text-primary-ink" />{t('team.title')}
      </h3>
      <p className="mb-3 text-sm text-ink-muted">{t('team.subtitle')}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-left text-xs font-bold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">{t('team.learner')}</th>
              <th className="px-3 py-2 text-right">{t('team.adopted')}</th>
              <th className="px-3 py-2 text-right">{t('team.forms')}</th>
              <th className="px-3 py-2 text-right">{t('team.lastActive')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => {
              const quiet = r.nil_days == null || r.nil_days > 7;
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2"><span className="font-semibold text-ink">{r.name}</span> <span className="text-xs text-ink-muted">· {r.role_group}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.target ? `${r.adoptions}/${r.target}` : r.adoptions}</td>
                  <td className={cn('px-3 py-2 text-right tabular-nums', (r.forms_pct ?? 0) < 50 && r.forms_due > 0 && 'font-semibold text-error-600 dark:text-error-300')}>
                    {r.forms_due ? `${r.forms_pct ?? 0}%` : '—'}
                  </td>
                  <td className={cn('px-3 py-2 text-right', quiet && 'font-semibold text-error-600 dark:text-error-300')}>
                    {r.nil_days == null ? t('team.never') : t('team.daysAgo', { count: r.nil_days })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export default MyTeamCard;
