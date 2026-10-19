import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Lightbulb, PlayCircle, ThumbsUp } from 'lucide-react';
import type { TestTopicReport } from '../../api/results';
import { ProgressBar } from '../ui';
import { cn } from '../../utils/cn';

const tone = (pct: number | null, pass: number) =>
  pct == null ? 'amber' : pct >= 80 ? 'sage' : pct >= pass ? 'amber' : 'coral';

/**
 * One test, topic by topic, with what to do about it (review of 18 Oct 2026,
 * Sir: "which particular topic got what percentage of score, and a small
 * inference — you have scored better in this area but you are still poor in
 * this component; it would be suggested you watch the videos related to it").
 * Short words and numbers: the learner reads this on a phone.
 */
const TestTopicsCard: React.FC<{ report: TestTopicReport; showTitle?: boolean }> = ({ report, showTitle = true }) => {
  const { t } = useTranslation('tests');
  const named = report.topics.filter(r => r.topic);
  const pass = report.passing_score_pct || 0;
  const list = (items: string[]) => items.join(', ');

  return (
    <div className="flex flex-col gap-3">
      {/* The total first and in bold, then the topics (review of 19 Oct
          2026: "if the total score is 100%, 5 out of 5 right, shouldn't that be
          focused first?"). */}
      {showTitle && (
        <div className="flex flex-col gap-1.5">
          <h4 className="font-display text-base font-bold text-ink">{report.title}</h4>
          <div className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-border bg-surface-sunken/70 px-3 py-2">
            <span className="text-sm font-semibold text-ink-muted">{t('topics.total')}</span>
            <span className="font-display text-2xl font-extrabold tabular-nums text-ink">{Math.round(report.score ?? 0)}%</span>
            <span className="text-sm font-semibold text-ink">{t('topics.rightOf', { correct: report.correct, total: report.total })}</span>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {report.topics.map(r => (
          <li key={r.topic ?? '—'} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className={cn('truncate text-sm', r.topic ? 'font-semibold text-ink' : 'text-ink-muted')}>
              {r.topic ?? (named.length ? t('topics.untagged') : t('topics.allQuestions'))}
            </span>
            <span className="text-sm font-bold tabular-nums text-ink">
              {Math.round(r.pct ?? 0)}% <span className="font-normal text-ink-muted">({r.correct}/{r.total})</span>
            </span>
            <div className="col-span-2"><ProgressBar value={r.pct ?? 0} tone={tone(r.pct, pass)} /></div>
          </li>
        ))}
      </ul>

      {named.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-sunken/70 p-3 text-sm">
          {report.strong.length > 0 && (
            <p className="flex items-start gap-2 text-ink">
              <ThumbsUp className="mt-0.5 size-4 shrink-0 text-success-600" />
              <span>{t('topics.strong', { topics: list(report.strong) })}</span>
            </p>
          )}
          {report.weak.length > 0 ? (
            <div className="flex items-start gap-2 text-ink">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p>{t('topics.weak', { topics: list(report.weak) })}</p>
                {report.videos.map(v => (
                  <p key={v.topic} className="mt-1 text-ink-muted">
                    {v.videos.length ? (
                      <>
                        {t('topics.watchAgain', { topic: v.topic })}{' '}
                        {v.videos.map((vid, i) => (
                          <React.Fragment key={vid.id}>
                            {i > 0 && ', '}
                            <Link to={`/tutorials/${vid.id}`} className="inline-flex items-center gap-1 font-semibold text-primary-ink hover:text-primary-ink-hover">
                              <PlayCircle className="size-3.5" />{vid.title}
                            </Link>
                          </React.Fragment>
                        ))}
                      </>
                    ) : t('topics.watchTopic', { topic: v.topic })}
                  </p>
                ))}
              </div>
            </div>
          ) : report.strong.length === 0 ? (
            <p className="flex items-start gap-2 text-ink">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>{t('topics.fine')}</span>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default TestTopicsCard;
