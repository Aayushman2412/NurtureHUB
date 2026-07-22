import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Film, Info, Link2 } from 'lucide-react';
import { Badge } from '../ui';
import type { FlowInfoNode } from '../../lib/flowTypes';
import { formatTimestamp, resolveAssetUrl, youTubeEmbedUrl } from '../../lib/flowGraph';

/**
 * Learner-facing render of an informational block: heading + body text,
 * illustrative images/GIFs, and an optional call-to-action (a YouTube clip
 * from a timestamp, an uploaded video, a link, or a "go do this" note). Purely
 * informational — collects no answer.
 */
interface InfoStepCardProps {
  node: FlowInfoNode;
}

const isSafeHttpUrl = (url: string): boolean => {
  try {
    const p = new URL(url.trim());
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
};

const InfoStepCard: React.FC<InfoStepCardProps> = ({ node }) => {
  const { t } = useTranslation('assessments');
  const a = node.action;

  const clipLabel =
    a.startSeconds != null && a.endSeconds != null
      ? t('plan.clipRange', { from: formatTimestamp(a.startSeconds), to: formatTimestamp(a.endSeconds) })
      : a.startSeconds != null
        ? t('plan.clipFrom', { time: formatTimestamp(a.startSeconds) })
        : null;

  const embed = a.type === 'youtube' ? youTubeEmbedUrl(a.url, a.startSeconds, a.endSeconds) : null;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-primary-ink">
        <Info className="size-5" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-wider">{t('runner.infoBadge')}</span>
      </div>

      {node.title.trim() && (
        <h2 className="text-balance font-display text-xl font-bold text-ink sm:text-2xl">{node.title}</h2>
      )}
      {node.body.trim() && (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-muted">{node.body}</p>
      )}

      {node.media.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {node.media.map((m, i) => (
            <img
              key={`${m.url}-${i}`}
              src={resolveAssetUrl(m.url)}
              alt=""
              className={
                node.media.length === 1
                  ? 'max-h-72 w-auto max-w-full rounded-xl border border-border object-contain'
                  : 'h-36 w-auto max-w-full rounded-lg border border-border object-contain sm:h-44'
              }
            />
          ))}
        </div>
      )}

      {embed && (
        <div className="mt-4">
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-sunken">
            <iframe
              src={embed}
              title={node.title || 'video'}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          {(a.message || clipLabel) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              {a.message && <span>{a.message}</span>}
              {clipLabel && <Badge variant="neutral">{clipLabel}</Badge>}
            </div>
          )}
        </div>
      )}

      {a.type === 'video' && a.url.trim() && (
        <div className="mt-4">
          <video controls preload="metadata" className="w-full rounded-lg" src={resolveAssetUrl(a.url)} />
          {a.message && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
              <Film className="size-3.5 shrink-0" aria-hidden />
              <span>{a.message}</span>
            </div>
          )}
        </div>
      )}

      {(a.type === 'notify' || a.type === 'info') && a.message.trim() && (
        <div className="mt-4 flex gap-3 rounded-lg bg-coral-50 px-4 py-3 dark:bg-coral-500/10">
          <span className="mt-0.5 shrink-0 text-primary-ink" aria-hidden>
            {a.type === 'notify' ? <Bell className="size-4.5" /> : <Info className="size-4.5" />}
          </span>
          <p className="text-sm leading-relaxed text-ink">{a.message}</p>
        </div>
      )}

      {a.type === 'youtube' && !embed && isSafeHttpUrl(a.url) && (
        <div className="mt-4 flex gap-3 rounded-lg bg-coral-50 px-4 py-3 dark:bg-coral-500/10">
          <span className="mt-0.5 shrink-0 text-primary-ink" aria-hidden>
            <Link2 className="size-4.5" />
          </span>
          <a
            href={a.url.trim()}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-primary-ink underline underline-offset-2"
          >
            {a.message || t('plan.watchClip')}
          </a>
        </div>
      )}
    </div>
  );
};

export default InfoStepCard;
