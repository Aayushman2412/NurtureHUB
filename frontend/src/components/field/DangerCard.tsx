import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, PlayCircle, Send } from 'lucide-react';
import type { BabyDanger } from '../../api/today';
import { getRefreshVideos, type RefreshTopic } from '../../api/today';
import { tellSupervisor } from '../../api/visits';
import { Button } from '../ui';

/** The refresh-video topic that fits this danger. */
const TOPIC: Record<BabyDanger['kind'], RefreshTopic['topic']> = {
  very_low_weight: 'sam', very_thin: 'sam', big_loss: 'weight',
};

/**
 * A baby to act on today (Learner Redesign review, 30 Oct 2026, fix 2: an
 * 8-month-old saved at 3 kg got only "see again within 2 days"). Three steps
 * in order — weigh again on the same scale; if it is still low, the PHC / NRC
 * today; tell the supervisor — with the button that tells the batch monitor,
 * what to talk to the mother about, and a video to watch again.
 */
const DangerCard: React.FC<{
  danger: BabyDanger; childId: number; name: string; ageText: string | null; hasSupervisor: boolean;
}> = ({ danger, childId, name, ageText, hasSupervisor }) => {
  const { t } = useTranslation('dashboard');
  const [state, setState] = useState<'idle' | 'sending' | 'told' | 'already' | 'none' | 'failed'>('idle');
  const [video, setVideo] = useState<RefreshTopic['videos'][number] | null>(null);

  useEffect(() => {
    let alive = true;
    getRefreshVideos()
      .then(r => {
        const topic = r.topics.find(x => x.topic === TOPIC[danger.kind]);
        if (alive) setVideo(topic?.videos[0] ?? null);
      })
      .catch(() => { /* the video is a bonus */ });
    return () => { alive = false; };
  }, [danger.kind]);

  const tell = async () => {
    setState('sending');
    try {
      const r = await tellSupervisor(childId);
      setState(r.sent ? 'told' : 'already');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setState(status === 409 ? 'none' : 'failed');
    }
  };

  const title = t(`field.danger.title.${danger.kind}`, {
    weight: danger.weight ?? '—', age: ageText ?? '', name, pct: danger.loss_pct ?? '',
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border-2 border-error-500 bg-error-50 p-4 dark:bg-error-500/10">
      <h2 className="flex items-start gap-2 font-display text-lg font-semibold text-error-700 dark:text-error-300">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />{title}
      </h2>
      <ol className="flex list-decimal flex-col gap-1 pl-6 text-sm font-semibold text-ink">
        <li>{t('field.danger.step1')}</li>
        <li>{t('field.danger.step2')}</li>
        <li>{hasSupervisor ? t('field.danger.step3') : t('field.danger.step3NoSupervisor')}</li>
      </ol>
      {hasSupervisor && (
        <div className="flex flex-col gap-1.5">
          <Button
            variant="danger"
            onClick={tell}
            loading={state === 'sending'}
            disabled={state === 'told' || state === 'already'}
            iconLeft={<Send className="size-4" />}
          >
            {t('field.danger.tell')}
          </Button>
          {state !== 'idle' && state !== 'sending' && (
            <p role="status" className="text-sm font-semibold text-ink">
              {t(`field.danger.${{ told: 'told', already: 'toldAlready', none: 'noSupervisor', failed: 'failed' }[state]}`)}
            </p>
          )}
        </div>
      )}
      <div className="rounded-md bg-surface px-3 py-2.5 text-sm text-ink">
        <p><b>{t('field.talk.title')}:</b> {t(`field.talk.${danger.kind}`)}</p>
        {video && (
          <Link to={`/tutorials/${video.id}`} className="mt-1.5 inline-flex items-center gap-1.5 font-semibold text-primary-ink hover:underline">
            <PlayCircle className="size-4" />
            {t('field.talk.video', { title: video.minutes ? `${video.title} (${t('field.refresh.minutes', { n: video.minutes })})` : video.title })}
          </Link>
        )}
      </div>
    </section>
  );
};

export default DangerCard;
