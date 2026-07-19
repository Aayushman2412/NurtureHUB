import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, Layers, Lock, X } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  DateInput,
  EmptyState,
  Modal,
  PageLoader,
  ProgressBar,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Input';
import { useToast } from '../../context/ToastContext';
import { getChild, type Child } from '../../api/children';
import { createResponse, getFormDefinition, getResponse, updateResponse } from '../../api/forms';
import type { FlowSchema, FormDefinition, FormKey } from '../../lib/flowTypes';
import { CF_MIN_AGE_DAYS, isFlowFormKey } from '../../lib/flowTypes';
import { flattenAnswerable, resolveAssetUrl } from '../../lib/flowGraph';
import OptionCard from '../../components/assessments/OptionCard';
import {
  apiErrorMessage,
  buildAnswersPayload,
  derivePath,
  isAnswered,
  pathAssessmentDate,
  todayIso,
  type AnswersMap,
  type PathStep,
} from '../../components/assessments/flowRunner';

/** Step transition keyframes — local to the runner, pure CSS. */
const runnerStyles = `
@keyframes assess-in-fwd { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes assess-in-back { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
.assess-step-fwd { animation: assess-in-fwd 0.28s cubic-bezier(0.4, 0, 0.2, 1) both; }
.assess-step-back { animation: assess-in-back 0.28s cubic-bezier(0.4, 0, 0.2, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .assess-step-fwd, .assess-step-back { animation: none; }
}
`;

const AssessmentRunnerPage: React.FC = () => {
  const { motherId: motherParam, childId: childParam, formKey: keyParam } = useParams();
  const motherId = Number(motherParam);
  const childId = Number(childParam);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation('assessments');
  const { showToast } = useToast();

  const validKey = isFlowFormKey(keyParam ?? '');
  const formKey = (keyParam ?? 'breastfeeding') as FormKey;
  const resumeIdParam = searchParams.get('responseId');
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;

  const historyUrl = `/mothers/${motherId}/children/${childId}/assessments/${formKey}`;

  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [answers, setAnswers] = useState<AnswersMap>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const [responseId, setResponseId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  const savedRef = useRef<string>(JSON.stringify({}));
  const advanceTimerRef = useRef<number | null>(null);
  const stepsLenRef = useRef(0);

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };
  useEffect(() => clearAdvanceTimer, []);

  // ── Load definition + child (+ draft when resuming) ────────────────────────
  useEffect(() => {
    if (!validKey) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      getFormDefinition(formKey),
      getChild(motherId, childId),
      resumeId != null ? getResponse(resumeId) : Promise.resolve(null),
    ])
      .then(([def, c, resp]) => {
        if (cancelled) return;
        setDefinition(def);
        setChild(c);
        if (resp) {
          const prefill: AnswersMap = {};
          // Validate the draft against the CURRENT definition — the admin may
          // have edited the form since it was saved. Deleted questions are
          // dropped; a choice question whose selected options no longer exist
          // is omitted entirely so it becomes the frontier and gets re-asked.
          const currentQuestions = new Map<string, { questionType: string; optionIds: Set<string> }>();
          if (def.builder_type === 'flow') {
            for (const { question } of flattenAnswerable(def.schema_json as FlowSchema)) {
              currentQuestions.set(question.id, {
                questionType: question.questionType,
                optionIds: new Set(question.options.map(o => o.id)),
              });
            }
          }
          for (const a of resp.answers_json) {
            const q = currentQuestions.get(a.nodeId);
            if (!q) continue;
            const optionIds = a.selected.map(s => s.optionId).filter(id => q.optionIds.has(id));
            const isChoice = q.questionType === 'single' || q.questionType === 'multi';
            if (isChoice && optionIds.length === 0) continue;
            prefill[a.nodeId] = { optionIds: isChoice ? optionIds : [], value: a.value ?? '' };
          }
          setAnswers(prefill);
          setResponseId(resp.id);
          savedRef.current = JSON.stringify(prefill);
          // Resume at the frontier: the first unanswered step on the derived path.
          if (def.builder_type === 'flow') {
            const { steps } = derivePath(def.schema_json as FlowSchema, prefill);
            const idx = steps.findIndex(s => !isAnswered(s.question, prefill[s.id]));
            setStepIndex(Math.max(0, idx < 0 ? steps.length - 1 : idx));
          }
        } else {
          savedRef.current = JSON.stringify({});
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
  }, [motherId, childId, formKey, resumeId, validKey]);

  // ── Derived path (replayed from answers — no manual step stack) ────────────
  const schema = useMemo<FlowSchema | null>(
    () => (definition?.builder_type === 'flow' ? (definition.schema_json as FlowSchema) : null),
    [definition],
  );
  const derived = useMemo(
    () => (schema ? derivePath(schema, answers) : { steps: [] as PathStep[], complete: false }),
    [schema, answers],
  );
  const totalQuestions = useMemo(() => (schema ? flattenAnswerable(schema).length : 0), [schema]);
  const answeredCount = useMemo(
    () => derived.steps.filter(s => isAnswered(s.question, answers[s.id])).length,
    [derived.steps, answers],
  );

  useEffect(() => {
    stepsLenRef.current = derived.steps.length;
  }, [derived.steps.length]);

  // Keep the cursor inside the (possibly shrunken) derived path.
  useEffect(() => {
    setStepIndex(i => Math.min(i, Math.max(0, derived.steps.length - 1)));
  }, [derived.steps.length]);

  const current: PathStep | undefined = derived.steps[stepIndex];

  // Default the FIRST date question on the path to today when it comes up empty.
  useEffect(() => {
    if (!current || current.question.questionType !== 'date') return;
    const firstDate = derived.steps.find(s => s.question.questionType === 'date');
    if (firstDate?.id !== current.id) return;
    setAnswers(prev =>
      prev[current.id]?.value ? prev : { ...prev, [current.id]: { optionIds: [], value: todayIso() } },
    );
  }, [current, derived.steps]);

  // ── Answer handlers ────────────────────────────────────────────────────────
  const setValueAnswer = (stepId: string, value: string) =>
    setAnswers(prev => ({ ...prev, [stepId]: { optionIds: [], value } }));

  const toggleOption = (step: PathStep, optionId: string) => {
    const q = step.question;
    if (q.questionType === 'single') {
      setAnswers(prev => ({ ...prev, [step.id]: { optionIds: [optionId], value: '' } }));
      // Auto-advance shortly after a single-select tap — feels fast, Back still works.
      clearAdvanceTimer();
      const fromIndex = stepIndex;
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        setDirection('fwd');
        setStepIndex(i => (i === fromIndex ? Math.min(i + 1, Math.max(0, stepsLenRef.current - 1)) : i));
      }, 350);
    } else {
      setAnswers(prev => {
        const cur = prev[step.id]?.optionIds ?? [];
        const next = cur.includes(optionId) ? cur.filter(x => x !== optionId) : [...cur, optionId];
        return { ...prev, [step.id]: { optionIds: next, value: '' } };
      });
    }
  };

  const goBack = () => {
    clearAdvanceTimer();
    setDirection('back');
    setStepIndex(i => Math.max(0, i - 1));
  };
  const goNext = () => {
    clearAdvanceTimer();
    setDirection('fwd');
    setStepIndex(i => Math.min(i + 1, Math.max(0, derived.steps.length - 1)));
  };

  // ── Persistence ────────────────────────────────────────────────────────────
  const persist = async (status: 'draft' | 'submitted') => {
    const payload = {
      assessment_date: pathAssessmentDate(derived.steps, answers),
      status,
      answers: buildAnswersPayload(derived.steps, answers),
    };
    const saved = responseId
      ? await updateResponse(responseId, payload)
      : await createResponse(formKey, { child_id: childId, ...payload });
    setResponseId(saved.id);
    savedRef.current = JSON.stringify(answers);
    return saved;
  };

  const saveDraft = async (thenExit: boolean) => {
    setSaving(true);
    try {
      await persist('draft');
      showToast(t('runner.draftSaved'), 'success');
      if (thenExit) navigate(historyUrl);
    } catch (err) {
      showToast(apiErrorMessage(err) ?? t('runner.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      const saved = await persist('submitted');
      navigate(`/assessments/${saved.id}/plan`, { replace: true });
    } catch (err) {
      showToast(apiErrorMessage(err) ?? t('runner.submitFailed'), 'error');
    } finally {
      setFinishing(false);
    }
  };

  const dirty = JSON.stringify(answers) !== savedRef.current;
  const handleExit = () => {
    if (dirty) setExitOpen(true);
    else navigate(historyUrl);
  };

  // ── Guards & frames ────────────────────────────────────────────────────────
  if (!validKey) return <Navigate to={`/mothers/${motherId}`} replace />;
  if (loading) return <PageLoader label={t('runner.loading')} className="min-h-60" />;

  if (loadError || !definition || !child || !schema) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Alert variant="error" title={t('common.loadFailedTitle')}>
          {t('common.loadFailedBody')}
        </Alert>
        <div>
          <Button variant="outline" onClick={() => navigate(historyUrl)}>
            {t('common.back')}
          </Button>
        </div>
      </div>
    );
  }

  // Client-side CF age gate (server enforces it too).
  if (
    formKey === 'complementary_feeding' &&
    (child.age_days == null || child.age_days < CF_MIN_AGE_DAYS)
  ) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500">
            <Lock className="size-6" aria-hidden />
          </div>
          <h3 className="mt-4 font-display text-lg font-bold text-ink">{t('runner.lockedTitle')}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            {t('runner.cfLockedBody', { min: CF_MIN_AGE_DAYS })}
          </p>
          <Button variant="outline" className="mt-5" onClick={() => navigate(historyUrl)}>
            {t('common.back')}
          </Button>
        </Card>
      </div>
    );
  }

  if (derived.steps.length === 0 || !current) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={<ClipboardList />}
          title={t('runner.emptyTitle')}
          description={t('runner.emptyBody')}
          action={
            <Button variant="outline" onClick={() => navigate(historyUrl)}>
              {t('common.back')}
            </Button>
          }
        />
      </div>
    );
  }

  const q = current.question;
  const answer = answers[current.id];
  const selectedIds = answer?.optionIds ?? [];
  const canProceed = !q.required || isAnswered(q, answer);
  const isLast = stepIndex === derived.steps.length - 1;
  const showFinish = isLast && derived.complete;
  const progressPct = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;

  return (
    <div className="flex flex-col">
      <style>{runnerStyles}</style>

      {/* Sticky top area: child + form identity, exit, progress */}
      <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-6 border-b border-border bg-background/90 px-5 pb-3 pt-4 backdrop-blur-md sm:-mx-6 sm:-mt-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-bold text-ink">
                {definition.title}
              </div>
              <div className="truncate text-xs text-ink-muted">
                {child.child_name}
                {child.child_uid ? ` · ${child.child_uid}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-semibold tabular-nums text-ink-muted">
                {t('runner.stepCounter', {
                  current: stepIndex + 1,
                  total: Math.max(totalQuestions, derived.steps.length),
                })}
              </span>
              <button
                type="button"
                onClick={handleExit}
                aria-label={t('runner.exit')}
                className="cursor-pointer rounded-full p-1.5 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
          <ProgressBar value={progressPct} size="sm" />
        </div>
      </div>

      {/* One question per screen */}
      <div className="mx-auto w-full max-w-2xl">
        {current.sectionId && (
          <div className="mb-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-100 px-3 py-1 text-xs font-semibold text-sage-700 dark:bg-sage-500/15 dark:text-sage-300">
              <Layers className="size-3.5" aria-hidden />
              {t('runner.sectionBanner', { title: current.sectionTitle })}
            </span>
          </div>
        )}

        <div key={current.id} className={direction === 'back' ? 'assess-step-back' : 'assess-step-fwd'}>
          <Card className="p-6 sm:p-8">
            <h2 className="text-balance text-center font-display text-xl font-bold text-ink sm:text-2xl">
              {q.title}
            </h2>
            {q.helpText && (
              <p className="mt-2 text-center text-sm text-ink-muted">{q.helpText}</p>
            )}
            {!q.required && (
              <p className="mt-2 text-center text-xs text-ink-faint">{t('runner.optionalHint')}</p>
            )}
            {(q.media?.length ?? 0) > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {q.media!.map((m, i) => (
                  <img
                    key={`${m.url}-${i}`}
                    src={resolveAssetUrl(m.url)}
                    alt=""
                    className={
                      q.media!.length === 1
                        ? 'max-h-64 w-auto max-w-full rounded-xl border border-border object-contain'
                        : 'h-32 w-auto max-w-full rounded-lg border border-border object-contain sm:h-40'
                    }
                  />
                ))}
              </div>
            )}

            <div className="mt-6">
              {q.questionType === 'date' && (
                <div className="mx-auto max-w-xs">
                  <DateInput
                    value={answer?.value ?? ''}
                    onChange={v => setValueAnswer(current.id, v)}
                    max={todayIso()}
                  />
                </div>
              )}

              {q.questionType === 'text' && (
                <textarea
                  rows={4}
                  value={answer?.value ?? ''}
                  onChange={e => setValueAnswer(current.id, e.target.value)}
                  placeholder={t('runner.textPlaceholder')}
                  className={inputClasses(false, false)}
                />
              )}

              {(q.questionType === 'single' || q.questionType === 'multi') && (
                <>
                  {q.questionType === 'multi' && (
                    <p className="mb-3 text-center text-xs font-semibold text-ink-faint">
                      {t('runner.multiHint')}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {q.options.map(o => (
                      <OptionCard
                        key={o.id}
                        option={o}
                        selected={selectedIds.includes(o.id)}
                        onToggle={() => toggleOption(current, o.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Footer controls */}
        <div className="mt-6 flex items-center gap-2 sm:gap-3">
          <Button
            variant="outline"
            onClick={goBack}
            disabled={stepIndex === 0 || finishing}
            iconLeft={<ArrowLeft className="size-4" />}
          >
            {t('runner.back')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => saveDraft(false)}
            loading={saving}
            disabled={finishing}
            className="ml-auto"
          >
            {t('runner.saveDraft')}
          </Button>
          {showFinish ? (
            <Button
              size="lg"
              onClick={finish}
              loading={finishing}
              disabled={!canProceed || saving}
              iconLeft={<CheckCircle2 className="size-4" />}
            >
              {t('runner.finish')}
            </Button>
          ) : (
            <Button
              onClick={goNext}
              disabled={!canProceed || finishing}
              iconRight={<ArrowRight className="size-4" />}
            >
              {t('runner.next')}
            </Button>
          )}
        </div>
      </div>

      {/* Exit confirmation */}
      <Modal
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title={t('runner.exitTitle')}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setExitOpen(false);
                navigate(historyUrl);
              }}
            >
              {t('runner.exitDiscard')}
            </Button>
            <Button variant="outline" disabled={saving} onClick={() => setExitOpen(false)}>
              {t('runner.exitKeep')}
            </Button>
            <Button loading={saving} onClick={() => saveDraft(true)}>
              {t('runner.exitSave')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">{t('runner.exitBody')}</p>
      </Modal>
    </div>
  );
};

export default AssessmentRunnerPage;
