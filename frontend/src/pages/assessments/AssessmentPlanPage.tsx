import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  Plus,
  Sparkles,
} from 'lucide-react';
import { Alert, Badge, Button, Card, PageLoader, ProgressRing } from '../../components/ui';
import { cn } from '../../utils/cn';
import { getFormDefinition, getResponse } from '../../api/forms';
import type { FlowSchema, FormResponseDetail, QuestionDisplayOverride } from '../../lib/flowTypes';
import {
  DEFAULT_DISPLAY,
  DEFAULT_VERDICTS,
  findVerdict,
  resolveDisplay,
  resolveQuestionDisplay,
  resolveVerdicts,
} from '../../lib/flowTypes';
import ActionCard from '../../components/assessments/ActionCard';
import ConfettiBurst from '../../components/assessments/ConfettiBurst';
import { formatDisplayDate } from '../../components/assessments/flowRunner';

const AssessmentPlanPage: React.FC = () => {
  const { responseId } = useParams();
  const id = Number(responseId);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('assessments');

  const [resp, setResp] = useState<FormResponseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [doingWellOpen, setDoingWellOpen] = useState(false);
  const [display, setDisplay] = useState(DEFAULT_DISPLAY);
  const [verdictDefs, setVerdictDefs] = useState(DEFAULT_VERDICTS);
  /** questionId -> that question's display override (from the definition). */
  const [overrides, setOverrides] = useState<Record<string, QuestionDisplayOverride>>({});

  /** Effective settings for one answered question (form defaults + override). */
  const displayFor = useCallback(
    (nodeId: string) => resolveQuestionDisplay(display, overrides[nodeId]),
    [display, overrides],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    getResponse(id)
      .then(async r => {
        if (cancelled) return;
        setResp(r);
        // The admin's learner-visibility switches live on the form definition.
        // A failure here must not break the plan — fall back to showing everything.
        try {
          const def = await getFormDefinition(r.form_key);
          if (cancelled) return;
          const s = def.schema_json as FlowSchema;
          setDisplay(resolveDisplay(s?.display));
          setVerdictDefs(resolveVerdicts(s?.verdicts));
          const map: Record<string, QuestionDisplayOverride> = {};
          for (const node of Object.values(s?.nodes ?? {})) {
            const qs = node.kind === 'section' ? node.children : [node];
            for (const q of qs) if (q.display) map[q.id] = q.display;
          }
          setOverrides(map);
        } catch {
          /* keep the defaults */
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Green answers ("doing well") and red answers with NO attached action —
  // the actioned ones render as ActionCards instead. When the admin has hidden
  // actions there are no such cards, so every red answer falls back to here
  // rather than disappearing from the plan entirely.
  const { doingWell, reviewItems } = useMemo(() => {
    const well: { key: string; question: string; labels: string[] }[] = [];
    const review: { key: string; question: string; label: string }[] = [];
    // Score by the verdict's polarity, not its id — a form may define its own
    // verdicts, and only `scoring` says which side of the ledger they fall on.
    const scoringOf = (v: string | null) => findVerdict(verdictDefs, v)?.scoring ?? 'neutral';
    for (const ans of resp?.answers_json ?? []) {
      const positives = ans.selected.filter(s => scoringOf(s.verdict) === 'positive');
      if (positives.length > 0) {
        well.push({ key: ans.nodeId, question: ans.question, labels: positives.map(s => s.label) });
      }
      for (const sel of ans.selected) {
        const negative = scoringOf(sel.verdict) === 'negative';
        if (negative && (!displayFor(ans.nodeId).actions || sel.action.type === 'none')) {
          review.push({ key: `${ans.nodeId}-${sel.optionId}`, question: ans.question, label: sel.label });
        }
      }
    }
    return { doingWell: well, reviewItems: review };
  }, [resp, displayFor, verdictDefs]);

  if (loading) return <PageLoader label={t('plan.loading')} className="min-h-60" />;

  if (loadError || !resp) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Alert variant="error" title={t('common.loadFailedTitle')}>
          {t('common.loadFailedBody')}
        </Alert>
        <div>
          <Button variant="outline" onClick={() => navigate('/mothers')}>
            {t('common.back')}
          </Button>
        </div>
      </div>
    );
  }

  const summary = resp.summary_json ?? { green: 0, red: 0, neutral: 0, answered: 0, total: 0 };
  const denom = summary.green + summary.red;
  const pct = denom > 0 ? (summary.green / denom) * 100 : 100;
  const allGreen = summary.red === 0 && summary.green > 0;
  // Admin can hide coaching actions form-wide or per question; still stored.
  const actions = (resp.actions_json ?? []).filter(a => displayFor(a.nodeId).actions);
  const isDraft = resp.status === 'draft';

  // Mother-level responses (child_id null) link to the mother-level assessment
  // path; child-level ones keep the child in the path.
  const historyUrl = resp.child_id != null
    ? `/mothers/${resp.mother_id}/children/${resp.child_id}/assessments/${resp.form_key}`
    : `/mothers/${resp.mother_id}/assessments/${resp.form_key}`;
  const runUrl = `${historyUrl}/run`;
  const formTitle = t(`common.formTitle.${resp.form_key}`, { defaultValue: resp.form_key });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {allGreen && !isDraft && <ConfettiBurst />}

      {isDraft && (
        <Alert variant="warning" title={t('plan.draftNotice')}>
          <button
            type="button"
            onClick={() => navigate(`${runUrl}?responseId=${resp.id}`)}
            className="cursor-pointer font-semibold text-primary underline underline-offset-2"
          >
            {t('plan.continueDraft')}
          </button>
        </Alert>
      )}

      {/* Celebration / score header */}
      <Card className="relative overflow-hidden p-6 sm:p-8">
        {allGreen && (
          <Sparkles
            aria-hidden
            className="absolute right-5 top-5 size-6 animate-pulse text-amber-500"
          />
        )}
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:gap-6 sm:text-left">
          <ProgressRing
            value={pct}
            size={108}
            strokeWidth={9}
            className="shrink-0 text-success-500"
            label={
              <span className="text-lg">
                {summary.green}
                <span className="text-sm text-ink-muted">/{denom}</span>
              </span>
            }
          />
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">
              {t('plan.scoreTitle', { green: summary.green, total: denom })}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {formTitle}
              {(resp.child_name ?? resp.mother_name) ? ` · ${resp.child_name ?? resp.mother_name}` : ''} ·{' '}
              {formatDisplayDate(resp.assessment_date, i18n.language)}
            </p>
            {allGreen ? (
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-success-600 dark:text-success-500">
                <Sparkles className="size-4" aria-hidden />
                {t('plan.allGreen')}
              </p>
            ) : (
              summary.red > 0 && (
                <p className="mt-2 text-sm text-ink-muted">
                  {t('plan.scoreSub', { red: summary.red })}
                </p>
              )
            )}
          </div>
        </div>
      </Card>

      {/* Needs attention — the coaching to-do list */}
      {actions.length > 0 && (
        <section>
          <div className="flex items-center gap-2">
            <AlertCircle className="size-5 text-error-500" aria-hidden />
            <h3 className="font-display text-lg font-bold text-ink">
              {t('plan.needsAttentionTitle')}
            </h3>
            <Badge variant="error">{actions.length}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{t('plan.needsAttentionSub')}</p>
          <div className="mt-4 flex flex-col gap-4">
            {actions.map((a, i) => (
              <ActionCard
                key={`${a.nodeId}-${a.optionId}-${i}`}
                item={a}
                index={i}
                verdictDef={
                  displayFor(a.nodeId).verdictTiming !== 'never'
                    ? findVerdict(verdictDefs, a.verdict)
                    : null
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Red answers with no attached action */}
      {reviewItems.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <ListChecks className="size-5 text-error-500" aria-hidden />
            <h3 className="font-display font-bold text-ink">{t('plan.reviewTitle')}</h3>
            <Badge variant="error">{reviewItems.length}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{t('plan.reviewSub')}</p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {reviewItems.map(item => (
              <li key={item.key} className="flex items-start gap-2.5 text-sm">
                <span
                  aria-hidden
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-error-500/70"
                />
                <span>
                  <span className="font-semibold text-ink">{item.question}</span>
                  <span className="text-ink-muted"> — {item.label}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Doing well — collapsible */}
      {doingWell.length > 0 && (
        <Card>
          <button
            type="button"
            onClick={() => setDoingWellOpen(o => !o)}
            aria-expanded={doingWellOpen}
            className="flex w-full cursor-pointer items-center justify-between gap-3 p-5 text-left"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success-500" aria-hidden />
              <span className="font-display font-bold text-ink">{t('plan.doingWellTitle')}</span>
              <Badge variant="success">{doingWell.length}</Badge>
            </span>
            <ChevronDown
              aria-hidden
              className={cn(
                'size-5 shrink-0 text-ink-faint transition-transform duration-200',
                doingWellOpen && 'rotate-180',
              )}
            />
          </button>
          {doingWellOpen && (
            <div className="animate-fade-in flex flex-col gap-3 border-t border-border px-5 py-4">
              {doingWell.map(item => (
                <div key={item.key}>
                  <div className="text-sm font-semibold text-ink">{item.question}</div>
                  <div className="mt-0.5 flex items-start gap-1.5 text-sm text-success-600 dark:text-success-500">
                    <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{item.labels.join(', ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Footer navigation */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="outline"
          onClick={() => navigate(historyUrl)}
          iconLeft={<ArrowLeft className="size-4" />}
        >
          {t('plan.backToAssessments')}
        </Button>
        <Button onClick={() => navigate(runUrl)} iconLeft={<Plus className="size-4" />}>
          {t('plan.newAssessment')}
        </Button>
      </div>
    </div>
  );
};

export default AssessmentPlanPage;
