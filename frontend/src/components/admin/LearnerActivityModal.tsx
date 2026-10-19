import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Award, ClipboardList, HeartHandshake, PlayCircle } from 'lucide-react';
import { getLearnerActivity, type LearnerActivity, type LearnerActivityEvent } from '../../api/adminLearners';
import { Modal, PageLoader } from '../ui';
import { cn } from '../../utils/cn';

const ICONS: Record<LearnerActivityEvent['kind'], React.ReactNode> = {
  form: <ClipboardList className="size-4" />,
  adoption: <HeartHandshake className="size-4" />,
  video: <PlayCircle className="size-4" />,
  test: <Award className="size-4" />,
};

const TONES: Record<LearnerActivityEvent['kind'], string> = {
  form: 'bg-sage-500/15 text-sage-700 dark:text-sage-300',
  adoption: 'bg-primary/10 text-primary-ink',
  video: 'bg-surface-sunken text-ink-muted',
  test: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * One learner's recent activity, day by day (review of 19 Oct 2026). Sir:
 * "in the recent activity I will see date, time, what she did ... did she just
 * adopt and let go, or did she really fill in some of the forms" — so each
 * line names the form and the mother and baby it was for, and opens the case.
 */
const LearnerActivityModal: React.FC<{ learnerId: number | null; name?: string; onClose: () => void }> = ({
  learnerId, name, onClose,
}) => {
  const { t } = useTranslation(['admin', 'growth']);
  const [data, setData] = useState<LearnerActivity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (learnerId == null) return;
    let gone = false;
    setData(null);
    setFailed(false);
    getLearnerActivity(learnerId)
      .then(d => { if (!gone) setData(d); })
      .catch(() => { if (!gone) setFailed(true); });
    return () => { gone = true; };
  }, [learnerId]);

  const days: [string, LearnerActivityEvent[]][] = [];
  for (const e of data?.events ?? []) {
    const k = dayKey(e.at);
    const last = days[days.length - 1];
    if (last && last[0] === k) last[1].push(e);
    else days.push([k, [e]]);
  }
  const daysSince = data?.last_active
    ? Math.floor((Date.now() - new Date(data.last_active).getTime()) / 86_400_000)
    : null;

  const line = (e: LearnerActivityEvent) => {
    switch (e.kind) {
      case 'form':
        return t('activity.form', { form: t(`growth:forms.${e.form_key}`, { defaultValue: e.form_key }) });
      case 'adoption':
        return t('activity.adoption');
      case 'video':
        return t('activity.video', { title: e.title });
      default:
        return t('activity.test', { title: e.title, score: Math.round(e.score ?? 0) });
    }
  };

  return (
    <Modal
      open={learnerId != null}
      onClose={onClose}
      size="lg"
      title={t('activity.title', { name: data?.learner.name ?? name ?? '' })}
    >
      {failed ? (
        <p className="text-sm text-error-600">{t('activity.loadFailed')}</p>
      ) : !data ? (
        <PageLoader label={t('activity.loading')} className="min-h-40" />
      ) : data.events.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">{t('activity.empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className={cn('rounded-lg px-3 py-2 text-sm font-semibold',
            daysSince != null && daysSince >= 3 ? 'bg-coral-500/10 text-coral-700 dark:text-coral-300' : 'bg-surface-sunken text-ink')}>
            {daysSince === 0 ? t('activity.activeToday') : t('activity.lastActive', { count: daysSince ?? 0 })}
          </p>
          {days.map(([day, events]) => (
            <section key={day}>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">{day}</h4>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {events.map((e, i) => (
                  <li key={`${e.kind}-${e.at}-${i}`} className="flex items-start gap-3 px-3 py-2">
                    <span className="w-16 shrink-0 whitespace-nowrap pt-0.5 text-xs tabular-nums text-ink-faint">{time(e.at)}</span>
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', TONES[e.kind])}>{ICONS[e.kind]}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold text-ink">{line(e)}</p>
                      {(e.mother || e.child) && (
                        <p className="text-ink-muted">
                          {e.mother && <>{e.mother.name} <span className="font-mono text-xs">{e.mother.uid}</span></>}
                          {e.child && (
                            <>
                              {' · '}
                              <Link to={`/admin/growth/cases/${e.child.id}`} className="font-semibold text-primary-ink hover:underline">
                                {e.child.name}
                              </Link>
                            </>
                          )}
                        </p>
                      )}
                      {e.kind === 'form' && e.assessment_date && (
                        <p className="text-xs text-ink-faint">{t('activity.visitOn', { date: e.assessment_date })}</p>
                      )}
                      {e.kind === 'adoption' && e.adoption_date && (
                        <p className="text-xs text-ink-faint">{t('activity.adoptedOn', { date: e.adoption_date })}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default LearnerActivityModal;
