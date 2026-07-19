import React from 'react';
import { Bell, Film, Info, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Card } from '../ui';
import type { TriggeredAction } from '../../lib/flowTypes';
import { formatTimestamp, resolveAssetUrl, youTubeEmbedUrl } from '../../lib/flowGraph';
import VerdictChip from './VerdictChip';

export interface ActionCardProps {
  item: TriggeredAction;
  index: number;
}

/** Only http(s) URLs may be rendered as clickable links. */
const isSafeHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const Callout: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({
  icon,
  children,
}) => (
  <div className="mt-4 flex gap-3 rounded-lg bg-coral-50 px-4 py-3 dark:bg-coral-500/10">
    <span className="mt-0.5 shrink-0 text-primary" aria-hidden>
      {icon}
    </span>
    <p className="text-sm leading-relaxed text-ink">{children}</p>
  </div>
);

/**
 * One coaching to-do: the question, the answer that triggered it, its verdict,
 * and the attached action (message callout, YouTube clip, or uploaded video).
 */
const ActionCard: React.FC<ActionCardProps> = ({ item, index }) => {
  const { t } = useTranslation('assessments');
  const a = item.action;

  const clipLabel =
    a.startSeconds != null && a.endSeconds != null
      ? t('plan.clipRange', { from: formatTimestamp(a.startSeconds), to: formatTimestamp(a.endSeconds) })
      : a.startSeconds != null
        ? t('plan.clipFrom', { time: formatTimestamp(a.startSeconds) })
        : a.endSeconds != null
          ? t('plan.clipUntil', { time: formatTimestamp(a.endSeconds) })
          : null;

  let body: React.ReactNode = null;
  if (a.type === 'notify' || a.type === 'info') {
    body = (
      <Callout icon={a.type === 'notify' ? <Bell className="size-4.5" /> : <Info className="size-4.5" />}>
        {a.message}
      </Callout>
    );
  } else if (a.type === 'youtube') {
    const embed = youTubeEmbedUrl(a.url, a.startSeconds, a.endSeconds);
    body = embed ? (
      <div className="mt-4">
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-sunken">
          <iframe
            src={embed}
            title={a.message || item.question}
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
    ) : (
      // Fallback link for un-embeddable YouTube URLs — only ever render an
      // http(s) href; admin-stored strings must not become javascript:/data: links.
      isSafeHttpUrl(a.url) && (
        <Callout icon={<Link2 className="size-4.5" />}>
          <a
            href={a.url.trim()}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-primary underline underline-offset-2"
          >
            {a.message || t('plan.watchClip')}
          </a>
        </Callout>
      )
    );
  } else if (a.type === 'video') {
    body = a.url.trim() ? (
      <div className="mt-4">
        <video controls preload="metadata" className="w-full rounded-lg" src={resolveAssetUrl(a.url)} />
        {a.message && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
            <Film className="size-3.5 shrink-0" aria-hidden />
            <span>{a.message}</span>
          </div>
        )}
      </div>
    ) : null;
  }

  return (
    <Card className="p-5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
        {t('plan.stepN', { n: index + 1 })}
      </div>
      <h4 className="mt-1 font-display font-bold leading-snug text-ink">{item.question}</h4>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">{t('plan.youChose')}</span>
        <span className="font-semibold text-ink">{item.optionLabel}</span>
        <VerdictChip verdict={item.verdict} />
      </div>
      {body}
    </Card>
  );
};

export default ActionCard;
