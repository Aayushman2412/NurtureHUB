import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, UsersRound } from 'lucide-react';
import client from '../api/client';
import { Card } from './ui';

interface Person { id?: number; name: string; phone: string | null; cadre?: string; role?: string | null }
interface SupportTeam {
  monitor: Person | null;
  batch: { name: string; start_date: string | null; end_date: string } | null;
  trainers: Person[];
  is_monitor: boolean;
  watching: Person[];
}

const Contact: React.FC<{ who: string; p: Person }> = ({ who, p }) => (
  <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2">
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{who}</div>
      <div className="truncate font-semibold text-ink">{p.name}{p.cadre && <span className="ml-1 text-xs font-normal text-ink-muted">· {p.cadre}</span>}</div>
    </div>
    {p.phone && (
      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-fg">
        <Phone className="size-3.5" />{p.phone}
      </a>
    )}
  </li>
);

/**
 * "My support team" (review of 6 Oct 2026): the learner's batch monitor and
 * the trainers of their training batch, one tap to call. A batch monitor also
 * sees the learners they watch over. Hidden when there is no one to show.
 */
const SupportTeamCard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const [team, setTeam] = useState<SupportTeam | null>(null);

  useEffect(() => {
    let active = true;
    client.get<SupportTeam>('/api/users/me/support-team')
      .then(r => { if (active) setTeam(r.data); })
      .catch(() => { /* optional card: stays hidden offline or on error */ });
    return () => { active = false; };
  }, []);

  if (!team || (!team.monitor && !team.trainers.length && !team.watching.length)) return null;
  return (
    <Card className="p-5">
      <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <UsersRound className="size-5 text-primary-ink" />{t('support.title')}
      </h3>
      {team.batch && <p className="mb-3 text-sm text-ink-muted">{t('support.batch', { name: team.batch.name })}</p>}
      <ul className="space-y-2">
        {team.monitor && <Contact who={t('support.monitor')} p={team.monitor} />}
        {team.trainers.map((p, i) => <Contact key={i} who={p.role || t('support.trainer')} p={p} />)}
      </ul>
      {team.is_monitor && (
        <>
          <h4 className="mb-2 mt-4 text-sm font-semibold text-ink">{t('support.watching', { count: team.watching.length })}</h4>
          {team.watching.length === 0 ? <p className="text-sm text-ink-muted">{t('support.watchingNone')}</p> : (
            <ul className="space-y-2">
              {team.watching.map(p => <Contact key={p.id} who={t('support.learner')} p={p} />)}
            </ul>
          )}
        </>
      )}
    </Card>
  );
};

export default SupportTeamCard;
