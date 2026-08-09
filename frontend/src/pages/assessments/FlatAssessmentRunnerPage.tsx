/**
 * Learner runner for `flat` forms (Check Growth).
 *
 * Unlike the flow runner (one branching question per step), a flat form is a
 * single scrolling page: most of its fields are conditional, so a stepper would
 * mostly show skipped steps. Visibility, validation and the submission payload
 * come from `lib/flatForm.ts`; the server re-validates all of it.
 *
 * Convention: the first `date` field in the definition is the response's
 * `assessment_date` (Check Growth → `measurement_date`). It starts EMPTY so the
 * learner must actively pick it (required, so submission blocks until then);
 * until picked, today stands in for age/visibility computations and drafts.
 * Child age for `ageLtDays` / `ageGteDays` conditions is computed against that
 * date, not against today.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Save, Send } from 'lucide-react';
import { Alert, Button, Card, EmptyState, PageHeader, PageLoader } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { getChild, type Child } from '../../api/children';
import { getMother, type Mother } from '../../api/mothers';
import {
  getFormDefinition, getResponse, listMotherResponses,
} from '../../api/forms';
import {
  findQueuedResponseCreate, findQueuedResponseUpdate, isQueuedResult, persistResponseResilient,
} from '../../offline/submit';
import { vaultClear, vaultKey, vaultLoad, vaultSave } from '../../offline/answerVault';
import type { FlatField, FlatSchema, FormDefinition, FormKey } from '../../lib/flowTypes';
import { isMotherFormKey } from '../../lib/flowTypes';
import {
  buildFlatAnswersPayload,
  buildFlatZodSchema,
  emptyFlatValues,
  isChoiceField,
  visibleFlatFields,
  type FlatFormValues,
} from '../../lib/flatForm';
import { toFieldErrors } from '../../lib/validation';
import { apiErrorMessage, todayIso } from '../../components/assessments/flowRunner';
import ChildChip from '../../components/assessments/ChildChip';
import FlatFieldInput from '../../components/assessments/FlatFieldInput';

/** Whole days between an ISO date of birth and an ISO reference date. */
const ageDaysAt = (dob: string | null | undefined, atIso: string): number | null => {
  if (!dob || !atIso) return null;
  const birth = new Date(`${dob.slice(0, 10)}T00:00:00`);
  const at = new Date(`${atIso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) return null;
  return Math.floor((at.getTime() - birth.getTime()) / 86_400_000);
};

/** "X completed weeks + Y completed days" from the mother's LMP at a date. */
const gestationalAgeText = (lmp: string | null | undefined, atIso: string): string => {
  const days = ageDaysAt(lmp, atIso);
  if (days == null || days < 0) return '';
  return `${Math.floor(days / 7)} completed weeks + ${days % 7} completed days`;
};

const FlatAssessmentRunnerPage: React.FC = () => {
  const { motherId: motherParam, childId: childParam, formKey: keyParam } = useParams();
  const motherId = Number(motherParam);
  const childId = Number(childParam);
  const formKey = (keyParam ?? 'growth_monitoring') as FormKey;
  /** Mother-level flat forms (antenatal) have no child in scope. */
  const motherLevel = isMotherFormKey(formKey);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation('assessments');
  const { showToast } = useToast();

  const resumeIdParam = searchParams.get('responseId');
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;

  const historyUrl = motherLevel
    ? `/mothers/${motherId}/assessments/${formKey}`
    : `/mothers/${motherId}/children/${childId}/assessments/${formKey}`;
  const today = useRef(todayIso()).current;

  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [mother, setMother] = useState<Mother | null>(null);
  /** Latest previously SUBMITTED weight (kg) — the weight-gain baseline. */
  const [previousWeight, setPreviousWeight] = useState<number | null>(null);
  const [values, setValues] = useState<FlatFormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Server row id, or a queued offline creation's `tmp-` id (coalesced on save). */
  const [responseId, setResponseId] = useState<number | string | null>(resumeId);
  /** Editing an already-submitted response — Save-draft is hidden (backend keeps
   *  it submitted). */
  const [editingSubmitted, setEditingSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fields: FlatField[] = useMemo(
    () => ((definition?.schema_json as FlatSchema | undefined)?.fields ?? []),
    [definition],
  );

  /** The date field that doubles as the response's assessment_date. */
  const dateFieldId = useMemo(() => fields.find(f => f.type === 'date')?.id ?? null, [fields]);

  const assessmentDate = useMemo(() => {
    if (!dateFieldId) return today;
    const raw = values[dateFieldId];
    const iso = typeof raw === 'string' ? raw.trim() : '';
    return iso || today;
  }, [dateFieldId, values, today]);

  const ageDays = useMemo(
    () => ageDaysAt(child?.dob ?? null, assessmentDate),
    [child?.dob, assessmentDate],
  );

  const visible = useMemo(
    () => visibleFlatFields(fields, values, ageDays),
    [fields, values, ageDays],
  );

  // ── Load definition + child (+ draft when resuming) ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      getFormDefinition(formKey),
      motherLevel ? Promise.resolve(null) : getChild(motherId, childId),
      motherLevel ? getMother(motherId) : Promise.resolve(null),
      resumeId != null ? getResponse(resumeId) : Promise.resolve(null),
      motherLevel ? listMotherResponses(formKey, motherId).catch(() => []) : Promise.resolve([]),
    ])
      .then(async ([def, c, m, resp, prior]) => {
        if (cancelled) return;
        setDefinition(def);
        setChild(c);
        setMother(m);

        // Weight-gain baseline: the most recent SUBMITTED visit other than the
        // one being edited. Its stored current_weight is a plain text answer.
        const previous = (prior ?? [])
          .filter(r => r.status === 'submitted' && r.id !== resumeId)
          .sort((a, b) => (a.assessment_date < b.assessment_date ? 1 : -1))[0];
        if (previous) {
          getResponse(previous.id)
            .then(full => {
              if (cancelled) return;
              const w = (full.answers_json ?? []).find(ans => ans.nodeId === 'current_weight');
              const n = w?.value != null ? parseFloat(String(w.value)) : NaN;
              setPreviousWeight(Number.isFinite(n) ? n : null);
            })
            .catch(() => {});
        }

        const defFields = (def.schema_json as FlatSchema | undefined)?.fields ?? [];
        const next = emptyFlatValues(defFields);

        // Rehydrate saved answers into form values. Accepts both the server
        // snapshot shape (`selected`) and the queued POST shape (`optionIds`).
        type SavedAnswer = {
          nodeId: string;
          value?: string | null;
          selected?: { optionId: string }[];
          optionIds?: string[];
        };
        const applyAnswers = (answersJson: SavedAnswer[]) => {
          const byId = new Map(defFields.map(f => [f.id, f]));
          for (const ans of answersJson) {
            const f = byId.get(ans.nodeId);
            if (!f) continue;
            if (isChoiceField(f)) {
              const ids = ans.selected ? ans.selected.map(s => s.optionId) : (ans.optionIds ?? []);
              next[f.id] = f.type === 'checkbox' ? ids : (ids[0] ?? '');
            } else {
              next[f.id] = ans.value ?? '';
            }
          }
        };

        // The vault/coalescing identity of this visit: server row, queued
        // offline creation's temp id, or null for a brand-new visit.
        let effectiveId: number | string | null = null;

        if (resp) {
          setEditingSubmitted(resp.status === 'submitted');
          effectiveId = resp.id;
          // A queued offline EDIT of this row is newer than the (possibly
          // stale-cached) server copy — its answers win; saving again
          // coalesces into the same queue item.
          const queuedUpdate = await findQueuedResponseUpdate(resp.id);
          applyAnswers(
            queuedUpdate
              ? ((queuedUpdate.answers as SavedAnswer[] | undefined) ?? [])
              : ((resp.answers_json ?? []) as SavedAnswer[]),
          );
        } else {
          // A visit already captured offline for this subject+form: adopt its
          // queue item — otherwise this session would enqueue a SECOND
          // creation and sync would produce duplicate rows.
          const queuedCreate = await findQueuedResponseCreate(
            formKey,
            motherLevel ? { mother_id: motherId } : { child_id: childId },
          );
          if (queuedCreate) {
            setResponseId(queuedCreate.tempId);
            effectiveId = queuedCreate.tempId;
            applyAnswers((queuedCreate.payload.answers as SavedAnswer[] | undefined) ?? []);
          }
        }
        if (cancelled) return;
        savedRef.current = JSON.stringify(next);
        // Crash/offline protection: unsaved answers from the vault are newer
        // than anything the server returned — they win.
        const wip = vaultLoad<FlatFormValues>(
          vaultKey(formKey, motherLevel ? `m${motherId}` : `c${childId}`, effectiveId ?? resumeId),
        );
        if (wip && Object.keys(wip).length > 0) {
          Object.assign(next, wip);
          showToast(t('restoredAnswers', { ns: 'offline' }), 'info');
        }
        setValues(next);
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
  }, [formKey, motherId, childId, motherLevel, resumeId]);

  // Mirror answers to the vault while editing; cleared on save/queue. Only
  // DIRTY states are vaulted — mirroring the untouched loaded values caused
  // spurious "restored answers" on the next open (and could resurrect a stale
  // snapshot over fresher server data).
  const savedRef = useRef<string>('{}');
  const wipKey = vaultKey(formKey, motherLevel ? `m${motherId}` : `c${childId}`, responseId ?? resumeId);
  useEffect(() => {
    if (loading) return;
    if (JSON.stringify(values) === savedRef.current) {
      vaultClear(wipKey);
      return;
    }
    vaultSave(wipKey, values);
  }, [values, loading, wipKey]);

  // ── Read-only computed fields (antenatal) ─────────────────────────────────
  const weightFieldId = 'current_weight';
  const computedValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of fields) {
      if (f.computed === 'gestational_age') {
        out[f.id] = gestationalAgeText(mother?.lmp ?? null, assessmentDate) || '—';
      } else if (f.computed === 'weight_gain') {
        const raw = values[weightFieldId];
        const current = typeof raw === 'string' ? parseFloat(raw) : NaN;
        if (!Number.isFinite(current)) out[f.id] = '—';
        else if (previousWeight == null) out[f.id] = 'First recorded visit — no previous weight';
        else {
          const diff = current - previousWeight;
          out[f.id] = `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} kg (previous: ${previousWeight.toFixed(1)} kg)`;
        }
      }
    }
    return out;
  }, [fields, mother?.lmp, assessmentDate, values, previousWeight]);

  // Mirror computed values into the answers map so they are stored verbatim.
  useEffect(() => {
    const patch: Record<string, string> = {};
    for (const [id, v] of Object.entries(computedValues)) {
      if ((values[id] ?? '') !== v) patch[id] = v;
    }
    if (Object.keys(patch).length > 0) setValues(prev => ({ ...prev, ...patch }));
  }, [computedValues, values]);

  const setValue = (id: string, v: string | string[]) => {
    setValues(prev => ({ ...prev, [id]: v }));
    setErrors(prev => (prev[id] ? { ...prev, [id]: '' } : prev));
  };

  // Offline-resilient: with no network the submission lands in the local sync
  // queue instead of failing (see src/offline/).
  const subjectLabel =
    `${t(`forms.${formKey}`, { ns: 'assessments', defaultValue: formKey })}` +
    ` — ${child?.child_name ?? mother?.mother_name ?? ''}`;

  const persist = async (status: 'draft' | 'submitted') => {
    const answers = buildFlatAnswersPayload(fields, values, ageDays);
    const payload = { assessment_date: assessmentDate, status, answers };
    const saved = await persistResponseResilient({
      formKey,
      responseId,
      subject: motherLevel ? { mother_id: motherId } : { child_id: childId },
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
    savedRef.current = JSON.stringify(values);
    vaultClear(wipKey);
    return saved;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const saved = await persist('draft');
      if (isQueuedResult(saved)) {
        showToast(t('runner.savedOffline', { ns: 'offline' }), 'success');
      } else {
        setResponseId(saved.id);
        showToast(t('growth.draftSaved'), 'success');
      }
    } catch (err) {
      showToast(apiErrorMessage(err) ?? t('growth.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    const schema = buildFlatZodSchema(fields, values, { t, ageDays, dobIso: child?.dob ?? null });
    // Computed fields are read-only text — they never block submission.
    // Only visible fields are in the schema, so parse only those keys.
    const subset: FlatFormValues = {};
    for (const f of visible) subset[f.id] = values[f.id] ?? (f.type === 'checkbox' ? [] : '');
    const result = schema.safeParse(subset);
    if (!result.success) {
      const fieldErrors = toFieldErrors(result);
      setErrors(fieldErrors);
      showToast(t('growth.fixErrors'), 'error');
      const firstId = Object.keys(fieldErrors)[0];
      if (firstId) document.getElementById(firstId)?.scrollIntoView({ block: 'center' });
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const saved = await persist('submitted');
      showToast(
        isQueuedResult(saved) ? t('runner.submittedOffline', { ns: 'offline' }) : t('growth.submitted'),
        'success',
      );
      navigate(historyUrl, { replace: true });
    } catch (err) {
      showToast(apiErrorMessage(err) ?? t('growth.saveFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageLoader label={t('runner.loading')} className="min-h-60" />;

  if (loadError || !definition || (motherLevel ? !mother : !child)) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
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

  if (fields.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={<ClipboardList />}
          title={t('growth.emptyFormTitle')}
          description={t('growth.emptyFormBody')}
        />
      </div>
    );
  }

  const busy = saving || submitting;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={definition.title}
        backTo={historyUrl}
        description={
          motherLevel && mother ? (
            <span className="mt-1 inline-flex items-center gap-2 text-sm text-ink-muted">
              <span className="font-semibold text-ink">{mother.mother_name}</span>
              <span className="font-mono text-xs">{mother.mother_uid}</span>
              {mother.lmp == null && (
                <span className="font-semibold text-amber-700 dark:text-amber-500">
                  No LMP on record — gestational age cannot be computed
                </span>
              )}
            </span>
          ) : child ? (
            <ChildChip
              name={child.child_name}
              uid={child.child_uid}
              ageDays={child.age_days}
              ageMonths={child.age_months}
              className="mt-1"
            />
          ) : undefined
        }
      />

      {!motherLevel && child && child.dob == null && (
        <Alert variant="warning" title={t('growth.noDobTitle')}>
          {t('growth.noDobBody')}
        </Alert>
      )}

      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        {visible.map(f =>
          f.computed ? (
            <div key={f.id} id={f.id}>
              <span className="mb-1.5 block text-sm font-semibold text-ink">{f.label}</span>
              <div className="rounded-lg border border-dashed border-border-strong/70 bg-surface-sunken/50 px-3.5 py-2.5 text-sm font-semibold text-ink">
                {computedValues[f.id] || '—'}
              </div>
              {f.helpText && <p className="mt-1 text-xs text-ink-muted">{f.helpText}</p>}
            </div>
          ) : (
            <FlatFieldInput
              key={f.id}
              field={f}
              value={values[f.id] ?? (f.type === 'checkbox' ? [] : '')}
              onChange={v => setValue(f.id, v)}
              error={errors[f.id]}
              disabled={busy}
              dobIso={child?.dob ?? null}
              todayIso={today}
            />
          ),
        )}
      </Card>

      {/* Mobile: primary action full-width on its own row so it is unmissable */}
      <div className="flex flex-col-reverse gap-2 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {!editingSubmitted && (
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            loading={saving}
            disabled={submitting}
            iconLeft={<Save className="size-4" />}
          >
            {t('growth.saveDraft')}
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          loading={submitting}
          disabled={saving}
          iconLeft={<Send className="size-4" />}
        >
          {editingSubmitted ? t('runner.saveChanges') : t('growth.submit')}
        </Button>
      </div>
    </div>
  );
};

export default FlatAssessmentRunnerPage;
