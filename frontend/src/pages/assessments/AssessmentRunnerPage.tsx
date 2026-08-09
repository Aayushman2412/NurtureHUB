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
import { getMother, type Mother } from '../../api/mothers';
import { getFormDefinition, getResponse } from '../../api/forms';
import {
  findQueuedResponseCreate, findQueuedResponseUpdate, isQueuedResult, persistResponseResilient,
} from '../../offline/submit';
import { vaultClear, vaultKey, vaultLoad, vaultSave } from '../../offline/answerVault';
import type { FlowSchema, FormDefinition, FormKey, MatrixAnswer } from '../../lib/flowTypes';
import {
  CF_MIN_AGE_DAYS,
  findVerdict,
  isExclusiveOption,
  isFlowFormKey,
  isMotherFormKey,
  parseMatrixAnswer,
  resolveDisplay,
  resolveQuestionDisplay,
  resolveVerdicts,
} from '../../lib/flowTypes';
import { flattenAnswerable, resolveAssetUrl } from '../../lib/flowGraph';
import { numberFlagState } from '../../lib/numericField';
import OptionCard from '../../components/assessments/OptionCard';
import InfoStepCard from '../../components/assessments/InfoStepCard';
import MatrixStepCard from '../../components/assessments/MatrixStepCard';
import {
  apiErrorMessage,
  buildAnswersPayload,
  derivePath,
  isAnswered,
  isMatrixAnswered,
  isStepAnswered,
  pathAssessmentDate,
  visibleMatrixRows,
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
  const isMother = isMotherFormKey(formKey);
  const resumeIdParam = searchParams.get('responseId');
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;

  const historyUrl = isMother
    ? `/mothers/${motherId}/assessments/${formKey}`
    : `/mothers/${motherId}/children/${childId}/assessments/${formKey}`;

  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [mother, setMother] = useState<Mother | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [answers, setAnswers] = useState<AnswersMap>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  /** Server row id, or a queued offline creation's `tmp-` id (coalesced on save). */
  const [responseId, setResponseId] = useState<number | string | null>(null);
  /** True when editing an already-submitted response — it can't be saved as a
   *  draft (the backend keeps it submitted), so the Save-draft control is hidden. */
  const [editingSubmitted, setEditingSubmitted] = useState(false);
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
      isMother ? getMother(motherId) : getChild(motherId, childId),
      resumeId != null ? getResponse(resumeId) : Promise.resolve(null),
    ])
      .then(async ([def, subject, resp]) => {
        if (cancelled) return;
        setDefinition(def);
        if (isMother) setMother(subject as Mother);
        else setChild(subject as Child);

        /**
         * Rehydrate saved answers, validating against the CURRENT definition —
         * the admin may have edited the form since. Deleted questions are
         * dropped; a choice question whose selected options no longer exist is
         * omitted entirely so it becomes the frontier and gets re-asked.
         * Accepts both the server snapshot shape (`selected`) and the queued
         * POST payload shape (`optionIds`).
         */
        type SavedAnswer = {
          nodeId: string;
          value?: string | null;
          selected?: { optionId: string }[];
          optionIds?: string[];
        };
        const buildPrefill = (answersJson: SavedAnswer[]): AnswersMap => {
          const prefill: AnswersMap = {};
          const currentQuestions = new Map<string, { questionType: string; optionIds: Set<string> }>();
          if (def.builder_type === 'flow') {
            for (const { question } of flattenAnswerable(def.schema_json as FlowSchema)) {
              currentQuestions.set(question.id, {
                questionType: question.questionType,
                optionIds: new Set(question.options.map(o => o.id)),
              });
            }
          }
          // Matrix nodes aren't in `currentQuestions` (they aren't answerable
          // "questions"); their JSON `value` is carried over verbatim below.
          const matrixIds = new Set<string>();
          if (def.builder_type === 'flow') {
            for (const node of Object.values((def.schema_json as FlowSchema).nodes)) {
              if (node.kind === 'matrix') matrixIds.add(node.id);
            }
          }
          for (const a of answersJson) {
            if (matrixIds.has(a.nodeId)) {
              prefill[a.nodeId] = { optionIds: [], value: a.value ?? '' };
              continue;
            }
            const q = currentQuestions.get(a.nodeId);
            if (!q) continue;
            const rawIds = a.selected ? a.selected.map(s => s.optionId) : (a.optionIds ?? []);
            const optionIds = rawIds.filter(id => q.optionIds.has(id));
            const isChoice = q.questionType === 'single' || q.questionType === 'multi';
            if (isChoice && optionIds.length === 0) continue;
            prefill[a.nodeId] = { optionIds: isChoice ? optionIds : [], value: a.value ?? '' };
          }
          return prefill;
        };

        const resumeAtFrontier = (prefill: AnswersMap) => {
          // A DRAFT resumes at the frontier — the first unanswered step — so the
          // learner carries on where they stopped. An already-SUBMITTED response
          // has no frontier (every step is answered), and dropping the learner on
          // the last question to review the whole form is useless: editing starts
          // at the beginning.
          if (def.builder_type !== 'flow') return;
          const { steps } = derivePath(def.schema_json as FlowSchema, prefill);
          const idx = steps.findIndex(s => !isStepAnswered(s, prefill));
          setStepIndex(Math.max(0, idx < 0 ? steps.length - 1 : idx));
        };

        // The vault/coalescing identity of this visit: server row, queued
        // offline creation's temp id, or null for a brand-new visit.
        let effectiveId: number | string | null = null;

        if (resp) {
          // A queued offline EDIT of this row is newer than the (possibly
          // stale-cached) server copy — its answers win, and saving again
          // coalesces into the same queue item instead of stacking edits.
          const queuedUpdate = await findQueuedResponseUpdate(resp.id);
          const source = queuedUpdate
            ? ((queuedUpdate.answers as SavedAnswer[] | undefined) ?? [])
            : resp.answers_json;
          const prefill = buildPrefill(source);
          setAnswers(prefill);
          setResponseId(resp.id);
          effectiveId = resp.id;
          setEditingSubmitted(resp.status === 'submitted');
          savedRef.current = JSON.stringify(prefill);
          if (resp.status !== 'submitted') resumeAtFrontier(prefill);
        } else {
          // A visit already captured offline for this subject+form: adopt its
          // queue item — otherwise this session would enqueue a SECOND
          // creation and sync would produce duplicate rows.
          const queuedCreate = await findQueuedResponseCreate(
            formKey,
            isMother ? { mother_id: motherId } : { child_id: childId },
          );
          if (queuedCreate) {
            const prefill = buildPrefill(
              (queuedCreate.payload.answers as SavedAnswer[] | undefined) ?? [],
            );
            setAnswers(prefill);
            setResponseId(queuedCreate.tempId);
            effectiveId = queuedCreate.tempId;
            savedRef.current = JSON.stringify(prefill);
            resumeAtFrontier(prefill);
          } else {
            savedRef.current = JSON.stringify({});
          }
        }
        if (cancelled) return;
        // Crash/offline protection: unsaved answers mirrored to the vault
        // (see effect below) win over whatever the server returned — they are
        // by definition newer than the last successful save.
        const wip = vaultLoad<AnswersMap>(
          vaultKey(formKey, isMother ? `m${motherId}` : `c${childId}`, effectiveId ?? resumeId),
        );
        if (wip && Object.keys(wip).length > 0) {
          setAnswers(prev => ({ ...prev, ...wip }));
          showToast(t('restoredAnswers', { ns: 'offline' }), 'info');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motherId, childId, formKey, resumeId, validKey, isMother]);

  // Mirror every answer change to the vault; cleared on save/queue/discard.
  // Keyed by the live visit identity (server id / queued tmp-id) so edits
  // after the first save keep one continuous vault slot.
  const wipKey = vaultKey(formKey, isMother ? `m${motherId}` : `c${childId}`, responseId ?? resumeId);
  useEffect(() => {
    if (loading) return;
    if (JSON.stringify(answers) === savedRef.current) {
      vaultClear(wipKey);
      return;
    }
    vaultSave(wipKey, answers);
  }, [answers, loading, wipKey]);

  // ── Derived path (replayed from answers — no manual step stack) ────────────
  const schema = useMemo<FlowSchema | null>(
    () => (definition?.builder_type === 'flow' ? (definition.schema_json as FlowSchema) : null),
    [definition],
  );
  /** Admin-set learner-visibility switches (absent ⇒ defaults). */
  const display = useMemo(() => resolveDisplay(schema?.display), [schema]);
  const verdictDefs = useMemo(() => resolveVerdicts(schema?.verdicts), [schema]);
  const derived = useMemo(
    () => (schema ? derivePath(schema, answers) : { steps: [] as PathStep[], complete: false }),
    [schema, answers],
  );
  const totalQuestions = useMemo(() => (schema ? flattenAnswerable(schema).length : 0), [schema]);
  const answeredCount = useMemo(
    () => derived.steps.filter(s => isStepAnswered(s, answers)).length,
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

  // ── Answer handlers ────────────────────────────────────────────────────────
  const setValueAnswer = (stepId: string, value: string) =>
    setAnswers(prev => ({ ...prev, [stepId]: { optionIds: [], value } }));

  const setMatrixCell = (stepId: string, rowId: string, colId: string, value: string) =>
    setAnswers(prev => {
      const grid: MatrixAnswer = parseMatrixAnswer(prev[stepId]?.value);
      const row = { ...(grid[rowId] ?? {}) };
      if (value) row[colId] = value;
      else delete row[colId];
      const nextGrid = { ...grid, [rowId]: row };
      return { ...prev, [stepId]: { optionIds: [], value: JSON.stringify(nextGrid) } };
    });

  const toggleOption = (step: Extract<PathStep, { kind: 'question' }>, optionId: string) => {
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
        let next: string[];
        if (cur.includes(optionId)) {
          next = cur.filter(x => x !== optionId);
        } else if (isExclusiveOption(q.options.find(o => o.id === optionId) ?? { label: '', exclusive: null })) {
          next = [optionId];   // "None" wipes the rest
        } else {
          // …and any real answer wipes "None".
          const exclusiveIds = new Set(q.options.filter(isExclusiveOption).map(o => o.id));
          next = [...cur.filter(x => !exclusiveIds.has(x)), optionId];
        }
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
  // Offline-resilient: when the network is gone the submission is captured in
  // the IndexedDB queue (synced automatically later) instead of erroring out.
  const subjectLabel =
    `${t(`forms.${formKey}`, { ns: 'assessments', defaultValue: formKey })}` +
    ` — ${child?.child_name ?? mother?.mother_name ?? ''}`;

  const persist = async (status: 'draft' | 'submitted') => {
    const payload = {
      assessment_date: pathAssessmentDate(derived.steps, answers),
      status,
      answers: buildAnswersPayload(derived.steps, answers),
    };
    const saved = await persistResponseResilient({
      formKey,
      responseId,
      subject: isMother ? { mother_id: motherId } : { child_id: childId },
      payload,
      label: subjectLabel,
    });
    // Bind the visit's identity so later saves UPDATE/COALESCE — never a
    // second creation (offline draft-then-submit must stay ONE row).
    if (isQueuedResult(saved)) {
      if (saved.tempId) setResponseId(saved.tempId);
    } else {
      setResponseId(saved.id);
    }
    savedRef.current = JSON.stringify(answers);
    vaultClear(wipKey);
    return saved;
  };

  const saveDraft = async (thenExit: boolean) => {
    setSaving(true);
    try {
      const saved = await persist('draft');
      showToast(
        isQueuedResult(saved) ? t('runner.savedOffline', { ns: 'offline' }) : t('runner.draftSaved'),
        'success',
      );
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
      if (isQueuedResult(saved)) {
        // No server id yet, so the plan page can't open — back to history with
        // a clear "will sync automatically" message instead.
        showToast(t('runner.submittedOffline', { ns: 'offline' }), 'success');
        navigate(historyUrl, { replace: true });
      } else {
        navigate(`/assessments/${saved.id}/plan`, { replace: true });
      }
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

  const subject = isMother ? mother : child;
  if (loadError || !definition || !subject || !schema) {
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

  const subjectName = isMother ? mother!.mother_name : child!.child_name;
  const subjectUid = isMother ? mother!.mother_uid : child!.child_uid;

  // Client-side CF age gate (server enforces it too). Child forms only.
  if (
    !isMother &&
    formKey === 'complementary_feeding' &&
    (child!.age_days == null || child!.age_days < CF_MIN_AGE_DAYS)
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

  const answer = answers[current.id];
  const selectedIds = answer?.optionIds ?? [];
  const canProceed =
    current.kind === 'info'
      ? true
      : current.kind === 'matrix'
        ? !current.matrix.required || isMatrixAnswered(current.matrix, answer, answers)
        : !current.question.required || isAnswered(current.question, answer);
  const isLast = stepIndex === derived.steps.length - 1;
  const showFinish = isLast && derived.complete;
  const denom = Math.max(totalQuestions, derived.steps.length);
  const progressPct = denom > 0 ? Math.min(100, (answeredCount / denom) * 100) : 0;

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
                {subjectName}
                {subjectUid ? ` · ${subjectUid}` : ''}
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
            {current.kind !== 'info' && current.preamble && current.preamble.length > 0 && (
              <div className="mb-6 space-y-6 border-b border-border pb-6">
                {current.preamble.map(info => (
                  <InfoStepCard key={info.id} node={info} />
                ))}
              </div>
            )}

            {current.kind === 'info' && <InfoStepCard node={current.info} />}

            {current.kind === 'matrix' && (
              <>
                <h2 className="text-balance text-center font-display text-xl font-bold text-ink sm:text-2xl">
                  {current.matrix.title}
                </h2>
                {current.matrix.helpText && (
                  <p className="mt-2 text-center text-sm text-ink-muted">{current.matrix.helpText}</p>
                )}
                <div className="mt-6">
                  <MatrixStepCard
                    node={current.matrix}
                    rows={visibleMatrixRows(current.matrix, answers)}
                    value={parseMatrixAnswer(answer?.value)}
                    onChange={(rowId, colId, v) => setMatrixCell(current.id, rowId, colId, v)}
                  />
                </div>
              </>
            )}

            {current.kind === 'question' &&
              (() => {
                const q = current.question;
                const qDisplay = resolveQuestionDisplay(display, q.display);
                const numberFlag =
                  q.questionType === 'number' ? numberFlagState(answer?.value ?? '', q.numeric) : null;
                return (
                  <>
                    <h2 className="text-balance text-center font-display text-xl font-bold text-ink sm:text-2xl">
                      {q.title}
                    </h2>
                    {qDisplay.helpText && q.helpText && (
                      <p className="mt-2 text-center text-sm text-ink-muted">{q.helpText}</p>
                    )}
                    {!q.required && (
                      <p className="mt-2 text-center text-xs text-ink-faint">{t('runner.optionalHint')}</p>
                    )}
                    {qDisplay.questionMedia && (q.media?.length ?? 0) > 0 && (
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

                      {q.questionType === 'number' && (
                        <div className="mx-auto max-w-xs">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={answer?.value ?? ''}
                            onChange={e => setValueAnswer(current.id, e.target.value)}
                            placeholder={t('runner.numberPlaceholder')}
                            className={`${inputClasses(!!numberFlag, false)} text-center`}
                          />
                          {numberFlag && (
                            <p className="mt-2 text-center text-xs text-error-600">
                              {t(`runner.${numberFlag.key}`, numberFlag.params)}
                            </p>
                          )}
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
                          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
                            {q.options.map(o => (
                              <OptionCard
                                key={o.id}
                                option={o}
                                selected={selectedIds.includes(o.id)}
                                onToggle={() => toggleOption(current, o.id)}
                                showMedia={qDisplay.optionMedia}
                                verdictDef={
                                  qDisplay.verdictTiming === 'during'
                                    ? findVerdict(verdictDefs, o.verdict)
                                    : null
                                }
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
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
          {!editingSubmitted && (
            <Button
              variant="ghost"
              onClick={() => saveDraft(false)}
              loading={saving}
              disabled={finishing}
              className="ml-auto"
            >
              {t('runner.saveDraft')}
            </Button>
          )}
          {showFinish ? (
            <Button
              size="lg"
              onClick={finish}
              loading={finishing}
              disabled={!canProceed || saving}
              iconLeft={<CheckCircle2 className="size-4" />}
              className={editingSubmitted ? 'ml-auto' : undefined}
            >
              {editingSubmitted ? t('runner.saveChanges') : t('runner.finish')}
            </Button>
          ) : (
            <Button
              onClick={goNext}
              disabled={!canProceed || finishing}
              iconRight={<ArrowRight className="size-4" />}
              className={editingSubmitted ? 'ml-auto' : undefined}
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
                vaultClear(wipKey);
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
