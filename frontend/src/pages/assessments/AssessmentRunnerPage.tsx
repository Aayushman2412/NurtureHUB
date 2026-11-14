import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, Layers, ListChecks, Lock, Pencil, X } from 'lucide-react';
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
import { getChild, listChildren, type Child } from '../../api/children';
import { getMother, type Mother } from '../../api/mothers';
import { getFormDefinition, getResponse } from '../../api/forms';
import {
  findQueuedResponseCreate, findQueuedResponseUpdate, isQueuedResult, persistResponseResilient,
} from '../../offline/submit';
import { vaultClear, vaultKey, vaultLoad, vaultSave } from '../../offline/answerVault';
import { flowString, nextInFlow, parseFlow } from '../../lib/careFlow';
import { cfGateMessage, usesNewProtocol, withoutQuestions } from '../../lib/visitProtocol';
import { getChildVisitPlan, type CfGate } from '../../api/visits';
import { optionLabel, useFormText } from '../../lib/formText';
import { formFlowChain } from '../../lib/formNames';
import { shortDay } from '../../components/field/fieldText';
import { useAuth } from '../../context/AuthContext';
import { proteinStatusOption } from '../../lib/autoAnswers';
import type { FlowOption, FlowSchema, FormDefinition, FormKey, MatrixAnswer } from '../../lib/flowTypes';
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
  formatDisplayDate,
  isAnswered,
  isMatrixAnswered,
  isStepAnswered,
  pathAssessmentDate,
  visibleMatrixRows,
  todayIso,
  type AnswersMap,
  type PathStep,
} from '../../components/assessments/flowRunner';

/** How a question's answers are laid out (review of 30 Oct 2026: "maybe two
 *  images like this would fit the screen … six and a scrollable option"):
 *  pictures two to a row; without pictures one slim line each; counts such as
 *  "0 days"–"7 days" as small boxes, four to a row. */
type OptionLayout = 'tile' | 'row' | 'chip';
const optionLayout = (options: FlowOption[], showMedia: boolean): OptionLayout =>
  showMedia && options.some(o => o.media.length > 0) ? 'tile'
    : options.length > 2 && options.every(o => /^\d/.test(o.label.trim())) ? 'chip' : 'row';
const OPTION_GRID: Record<OptionLayout, string> = {
  tile: 'grid grid-cols-2 gap-2.5 md:grid-cols-3',
  row: 'grid grid-cols-1 gap-2 sm:grid-cols-2',
  chip: 'grid grid-cols-4 gap-2',
};
const optionGridClass = (options: FlowOption[], showMedia: boolean) => OPTION_GRID[optionLayout(options, showMedia)];

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
  const { t, i18n } = useTranslation('assessments');
  const { showToast } = useToast();
  const { user } = useAuth();
  /** Breastfeeding points that dropped out and are not asked (November 2026 protocol). */
  const [hiddenCount, setHiddenCount] = useState(0);
  /** November 2026 protocol: a CF form is not filled before its day. */
  const [cfGate, setCfGate] = useState<CfGate | null>(null);

  const validKey = isFlowFormKey(keyParam ?? '');
  const formKey = (keyParam ?? 'breastfeeding') as FormKey;
  /** The form's questions in the learner's language, English underneath. */
  const words = useFormText(formKey);
  const isMother = isMotherFormKey(formKey);
  const resumeIdParam = searchParams.get('responseId');
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;
  /** A guided run of forms (lib/careFlow): what comes after this one. */
  const flow = parseFlow(searchParams.get('flow'));

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
  /** The answers listed for checking before they are submitted (review of 30
   *  Oct 2026: "before submission ask — these are the following information
   *  which you have filled, kindly confirm"; a pen beside each to change it). */
  const [reviewing, setReviewing] = useState(false);
  /** Came from the review list to change one answer: Next goes back to it. */
  const [returnToReview, setReturnToReview] = useState(false);

  const savedRef = useRef<string>(JSON.stringify({}));
  const advanceTimerRef = useRef<number | null>(null);
  const stepsLenRef = useRef(0);
  const returnToReviewRef = useRef(false);

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
    // November 2026 protocol: a breastfeeding question answered green in two
    // back-to-back forms is not shown again (docs/visit-protocol-2026-11.md).
    // … and a complementary feeding form is not filled before its day.
    const wantsPlan = (formKey === 'breastfeeding' || formKey === 'complementary_feeding') && !isMother && usesNewProtocol(user);
    Promise.all([
      getFormDefinition(formKey),
      isMother ? getMother(motherId) : getChild(motherId, childId),
      resumeId != null ? getResponse(resumeId) : Promise.resolve(null),
      wantsPlan ? getChildVisitPlan(childId).catch(() => null) : Promise.resolve(null),
    ])
      .then(async ([loaded, subject, resp, plan]) => {
        if (cancelled) return;
        // Only a new form or a draft: re-opening a submitted one must keep
        // every answer it holds.
        const hidden = resp?.status === 'submitted' || formKey !== 'breastfeeding' ? [] : plan?.bf?.hidden_questions ?? [];
        if (formKey === 'complementary_feeding' && !resp) setCfGate(plan?.cf ?? null);
        const def = hidden.length && loaded.builder_type === 'flow'
          ? { ...loaded, schema_json: withoutQuestions(loaded.schema_json as FlowSchema, hidden) }
          : loaded;
        if (def !== loaded) {
          setHiddenCount(flattenAnswerable(loaded.schema_json as FlowSchema).length
            - flattenAnswerable(def.schema_json as FlowSchema).length);
        }
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
          // A submitted form opens on its answers, each with a pen — not
          // step by step from the start (review of 30 Oct 2026).
          else setReviewing(true);
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
            // Protein form: "Mother's Status" is where she is now — pregnant
            // until her baby is registered (review of 30 Oct 2026: a pregnant
            // woman "took up the option of lactating").
            const statusNode = (def.schema_json as FlowSchema).nodes?.pca_status;
            if (formKey === 'mother_protein_intake' && isMother && statusNode?.kind === 'question') {
              const m = subject as Mother;
              const kids = await listChildren(motherId).catch(() => []);
              const delivered = kids.length > 0 || m.declared_adoption_type === 'pnc_lt5' || m.declared_adoption_type === 'pnc_ge5';
              const optionId = proteinStatusOption(!delivered);
              if (statusNode.options.some(o => o.id === optionId)) {
                const prefill: AnswersMap = { pca_status: { optionIds: [optionId], value: '' } };
                setAnswers(prefill);
                savedRef.current = JSON.stringify(prefill);
              }
            }
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
  useEffect(() => {
    returnToReviewRef.current = returnToReview;
  }, [returnToReview]);

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
        if (returnToReviewRef.current) {
          setReturnToReview(false);
          setReviewing(true);
          return;
        }
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
    if (returnToReview) {
      setReturnToReview(false);
      setReviewing(true);
      return;
    }
    setDirection('fwd');
    setStepIndex(i => Math.min(i + 1, Math.max(0, derived.steps.length - 1)));
  };
  /** From the review list to one question; Next brings the learner back. */
  const editStep = (index: number) => {
    clearAdvanceTimer();
    setReviewing(false);
    setReturnToReview(true);
    setDirection('back');
    setStepIndex(index);
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
        navigate(flow?.rest.length ? nextInFlow(flow, motherId, isMother ? null : childId) : historyUrl,
          { replace: true });
      } else {
        // The plan carries the flow on, so its "Continue" opens the next step.
        navigate(`/assessments/${saved.id}/plan${flow ? `?flow=${flowString(flow.kind, flow.rest)}` : ''}`,
          { replace: true });
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
          <div className="inline-flex shrink-0 text-amber-600 dark:text-amber-500">
            <Lock className="size-6" aria-hidden />
          </div>
          <h3 className="mt-4 font-display text-lg font-semibold text-ink">{t('runner.lockedTitle')}</h3>
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

  // November 2026 protocol: "the app does not allow a CF before its
  // scheduled day" — opened too early, it says when the next one is
  // (Learner Redesign review, 30 Oct 2026). A form already begun opens.
  const cfBlocked = !isMother && resumeId == null ? cfGateMessage(cfGate ?? undefined, t, shortDay) : null;
  if (cfBlocked) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="p-8 text-center">
          <div className="inline-flex shrink-0 text-amber-600 dark:text-amber-500">
            <Lock className="size-6" aria-hidden />
          </div>
          <h3 className="mt-4 font-display text-lg font-semibold text-ink">{t('cfGate.title')}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{cfBlocked}</p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => navigate(flow ? nextInFlow(flow, motherId, childId) : `/babies/${childId}`)}
          >
            {flow?.rest.length ? t(`flow.next.${flow.rest[0]}`) : t('field.cfGate.back', { ns: 'dashboard' })}
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
  /** Every required step answered — the review list can be submitted. */
  const allRequiredAnswered = derived.steps.every(step =>
    step.kind === 'info'
    || !(step.kind === 'question' ? step.question.required : step.matrix.required)
    || isStepAnswered(step, answers));
  /** Question numbers for the review list ("you can add question number 1 2 3 4"). */
  const numberOf = new Map<string, number>();
  derived.steps.filter(step => step.kind !== 'info').forEach((step, i) => numberOf.set(step.id, i + 1));
  /** One line per answer for the review list. */
  const answerText = (step: PathStep): string => {
    const a = answers[step.id];
    if (step.kind === 'matrix') {
      const rows = Object.values(parseMatrixAnswer(a?.value)).filter(r => Object.keys(r).length > 0).length;
      return rows > 0 ? t('runner.matrixRows', { count: rows }) : '';
    }
    if (step.kind !== 'question') return '';
    const q = step.question;
    if (q.questionType === 'single' || q.questionType === 'multi') {
      return q.options.filter(o => a?.optionIds.includes(o.id)).map(o => words.option(q.id, o.id, o.label).main).join(', ');
    }
    if (q.questionType === 'date') return a?.value ? formatDisplayDate(a.value, i18n.language) : '';
    return a?.value ?? '';
  };
  const denom = Math.max(totalQuestions, derived.steps.length);
  const progressPct = denom > 0 ? Math.min(100, (answeredCount / denom) * 100) : 0;

  return (
    <div className="flex flex-col">
      <style>{runnerStyles}</style>

      {/* Sticky top area: child + form identity, exit, progress */}
      <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-6 border-b border-border bg-background px-5 pb-3 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            {/* Back lives up here, always in the same place (review of 30 Oct
                2026: "back button should be on the top"). */}
            <button
              type="button"
              onClick={reviewing ? () => { setReviewing(false); setStepIndex(derived.steps.length - 1); }
                : stepIndex > 0 ? goBack : handleExit}
              disabled={finishing}
              aria-label={t('runner.back')}
              className="-ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-sm font-semibold text-ink">
                {formFlowChain(formKey, [], t).current ?? definition.title}
              </div>
              <div className="truncate text-xs text-ink-muted">
                {subjectName}
                {subjectUid ? ` · ${subjectUid}` : ''}
                {flow && flow.rest.length > 0 && ` · ${t('flow.then', { forms: formFlowChain(formKey, flow.rest, t).next.join(' → ') })}`}
              </div>
              {hiddenCount > 0 && (
                <div className="text-xs text-ink-muted">{t('runner.pointsHidden', { count: hiddenCount })}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-semibold tabular-nums text-ink-muted">
                {reviewing ? t('runner.reviewCounter') : t('runner.stepCounter', {
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

      {/* One question per screen — or, before submitting, every answer */}
      <div className="mx-auto w-full max-w-2xl pb-6">
        {reviewing ? (
          <Card className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
              <ListChecks className="size-5 text-primary-ink" />{t('runner.reviewTitle')}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{t('runner.reviewHint')}</p>
            <ol className="mt-4 flex flex-col divide-y divide-border">
              {derived.steps.map((step, i) => {
                if (step.kind === 'info') return null;
                const title = step.kind === 'question' ? words.title(step.id, step.question.title).main : step.matrix.title;
                const required = step.kind === 'question' ? step.question.required : step.matrix.required;
                const done = isStepAnswered(step, answers);
                const text = answerText(step);
                return (
                  <li key={step.id}>
                    <button type="button" onClick={() => editStep(i)}
                      className="flex w-full cursor-pointer items-start gap-3 py-3 text-left hover:bg-surface-sunken/60">
                      <span className="mt-0.5 w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-muted">{numberOf.get(step.id)}.</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{title}</span>
                        <span className={required && !done ? 'block text-sm font-semibold text-error-600 dark:text-error-400' : 'block text-sm text-ink-muted'}>
                          {done && text ? text : required ? t('runner.notAnswered') : t('runner.skipped')}
                        </span>
                      </span>
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-primary-ink" aria-label={t('runner.change')}>
                        <Pencil className="size-4" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Card>
        ) : (
        <>
        {current.sectionId && (
          <div className="mb-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-success-100 px-3 py-1 text-xs font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-300">
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
                <h2 className="text-balance text-center font-display text-xl font-semibold text-ink sm:text-2xl">
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
                    <h2 className="text-balance text-center font-display text-xl font-semibold text-ink sm:text-2xl">
                      {words.title(q.id, q.title).main}
                    </h2>
                    {words.title(q.id, q.title).english && (
                      <p className="mt-1 text-center text-sm text-ink-muted" lang="en">{words.title(q.id, q.title).english}</p>
                    )}
                    {qDisplay.helpText && q.helpText && (
                      <p className="mt-2 text-center text-sm text-ink-muted">{words.help(q.id, q.helpText).main}</p>
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
                                ? 'max-h-64 w-auto max-w-full rounded-lg border border-border object-contain'
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
                          <div className={optionGridClass(q.options, qDisplay.optionMedia)}>
                            {[...q.options.filter(isExclusiveOption), ...q.options.filter(o => !isExclusiveOption(o))].map(o => (
                              <OptionCard
                                key={o.id}
                                option={{ ...o, label: optionLabel(words.option(q.id, o.id, o.label)) }}
                                selected={selectedIds.includes(o.id)}
                                onToggle={() => toggleOption(current, o.id)}
                                showMedia={qDisplay.optionMedia}
                                layout={optionLayout(q.options, qDisplay.optionMedia)}
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
        </>
        )}
      </div>

      {/* Footer controls: fixed at the bottom of the screen, so Next never
          moves while the options above it change (review of 30 Oct 2026). */}
      <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-background px-5 py-3 sm:-mx-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 sm:gap-3">
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
          {reviewing ? (
            <Button
              size="lg"
              onClick={finish}
              loading={finishing}
              disabled={!derived.complete || !allRequiredAnswered || saving}
              iconLeft={<CheckCircle2 className="size-4" />}
              className={editingSubmitted ? 'ml-auto' : undefined}
            >
              {editingSubmitted ? t('runner.saveChanges') : t('runner.confirmSubmit')}
            </Button>
          ) : showFinish || returnToReview ? (
            <Button
              size="lg"
              onClick={() => { clearAdvanceTimer(); setReturnToReview(false); setReviewing(true); }}
              disabled={!canProceed || finishing}
              iconRight={<ArrowRight className="size-4" />}
              className={editingSubmitted ? 'ml-auto' : undefined}
            >
              {returnToReview ? t('runner.backToReview') : t('runner.review')}
            </Button>
          ) : (
            <Button
              size="lg"
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
