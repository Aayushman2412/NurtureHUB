import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Phone, PhoneCall } from 'lucide-react';
import { getMyTeam, type MyTeamRow } from '../../api/myWork';
import { buttonClasses, Card } from '../ui';
import { cn } from '../../utils/cn';

/** What to talk about on the call, in words: "2 late visits", "1 baby to see". */
const Reasons: React.FC<{ r: MyTeamRow }> = ({ r }) => {
  const { t } = useTranslation('dashboard');
  const parts: { text: string; red: boolean }[] = [];
  if (r.urgent_babies) parts.push({ text: t('field.team.urgent', { count: r.urgent_babies }), red: true });
  if (r.late_visits) parts.push({ text: t('field.team.late', { count: r.late_visits }), red: true });
  if (r.nil_days == null) parts.push({ text: t('field.team.never'), red: false });
  else if (r.nil_days > 7) parts.push({ text: t('field.team.quiet', { count: r.nil_days }), red: false });
  if (!parts.length) {
    return <span className="mt-1 block text-xs font-semibold text-success-600 dark:text-success-500">{t('field.team.onTrack')}</span>;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {parts.map(p => (
        <span key={p.text} className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold',
          p.red ? 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-300'
            : 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300')}>
          {p.text}
        </span>
      ))}
    </span>
  );
};

/** How many learners show before "Show all". */
const FIRST = 5;

/**
 * A batch monitor's first screen (launch review of 19 Oct 2026): "when
 * monitors log in they should get all the information — who are the learners
 * who need hand-holding right away". Only the learners to call, with why and a
 * call button; counts only, no mother is named.
 */
const TeamCallList: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const [rows, setRows] = useState<MyTeamRow[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    getMyTeam().then(r => { if (alive) setRows(r.learners); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);
  if (!rows || rows.length === 0) return null;
  // The ones to call first (the server sorts them to the top); "See all"
  // opens the whole team.
  const toCall = rows.filter(r => r.needs_call);
  const shown = all ? rows : toCall.slice(0, FIRST);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <PhoneCall className="size-5 text-primary-ink" />{t('field.team.title')}
        {toCall.length > 0 && <span className="rounded-full bg-error-50 px-2 py-0.5 text-sm font-bold text-error-700 dark:bg-error-500/15 dark:text-error-300">{toCall.length}</span>}
      </h2>
      {toCall.length === 0 && !all ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-success-600 dark:text-success-500">
          <Check className="size-5" />{t('field.team.allFine', { count: rows.length })}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {shown.map(r => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{r.name}</span>
                <Reasons r={r} />
              </span>
              {r.phone && (
                <a href={`tel:${r.phone}`} className={buttonClasses('outline', 'sm', 'shrink-0')} aria-label={t('field.team.call', { name: r.name })}>
                  <Phone className="size-4" />{t('field.team.callShort')}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length || all ? (
        <button type="button" onClick={() => setAll(v => !v)} className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-primary-ink">
          <ChevronDown className={cn('size-4 transition-transform', all && 'rotate-180')} />
          {all ? t('field.team.fewer') : t('field.team.showAll', { count: rows.length })}
        </button>
      ) : null}
    </Card>
  );
};

export default TeamCallList;
