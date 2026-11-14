import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, PlayCircle, RefreshCw } from 'lucide-react';
import { getRefreshVideos, type RefreshTopic } from '../../api/today';
import { Card } from '../ui';

/**
 * Videos to watch again, picked from her own babies and mothers (Learner
 * Redesign review, 30 Oct 2026, fix 16: "after she passes, put 'Refresh
 * videos' linked to her current cases at the top — e.g. the SAM video when a
 * baby is very thin"). Backend app/refresh_videos.py; nothing shows when no
 * case calls for a video.
 */
const RefreshVideos: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const [topics, setTopics] = useState<RefreshTopic[]>([]);

  useEffect(() => {
    let alive = true;
    getRefreshVideos().then(r => { if (alive) setTopics(r.topics); }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, []);

  if (topics.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <RefreshCw className="size-5 text-primary-ink" />{t('field.refresh.title')}
        </h2>
        <p className="text-sm text-ink-muted">{t('field.refresh.subtitle')}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {topics.map(topic => (
          <li key={topic.topic} className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-ink">{t(`field.refresh.topic.${topic.topic}`, { count: topic.count })}</p>
            {topic.videos.map(v => (
              <Link key={v.id} to={`/tutorials/${v.id}`}
                className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-sunken">
                <PlayCircle className="size-5 shrink-0 text-primary-ink" />
                <span className="min-w-0 flex-1 font-semibold text-ink">{v.title}</span>
                {v.minutes != null && <span className="shrink-0 text-xs text-ink-muted">{t('field.refresh.minutes', { n: v.minutes })}</span>}
                {v.watched && <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-label={t('field.refresh.watched')} />}
              </Link>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default RefreshVideos;
