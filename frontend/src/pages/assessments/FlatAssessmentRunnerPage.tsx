/**
 * Learner runner for `flat` forms (Check Growth, the pregnancy check).
 *
 * One question per screen (Learner Redesign review, 30 Oct 2026: "the Growth
 * check and Pregnancy check are long single pages … one guided flow per
 * visit, one question per screen"), the way the flow runner already works:
 * Back on top, Next fixed at the bottom, and before submitting every answer
 * listed with a pen to change it. The screens are the fields visible now —
 * a field's conditions are re-read on every answer, so a "No" that hides
 * three questions simply shortens the path. Read-only computed fields
 * (gestational age, weight gain) ride on the screen before them.
 * Visibility, validation and the submission payload come from
 * `lib/flatForm.ts`; the server re-validates all of it.
 *
 * Convention: the first `date` field in the definition is the response's
 * `assessment_date` (Check Growth → `measurement_date`). It starts EMPTY so the
 * learner must actively pick it (supervisor review, July 2026) — a "Today"
 * button makes that one tap; until picked, today stands in for
 * age/visibility computations and drafts. Child age for `ageLtDays` /
 * `ageGteDays` conditions (fields and options) is computed against that date.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarCheck, CheckCircle2, ClipboardList, History, ListChecks, Pencil,
  ShieldCheck, X,
} from 'lucide-react';
import { Alert, Button, Card, EmptyState, PageLoader, ProgressBar } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { getChild, type Child } from '../../api/children';
import { getMother, type Mother } from '../../api/mothers';
import {
  getFormDefinition, getResponse, listChildResponses, listMotherResponses,
} from '../../api/forms';
import { getMyGrowthCaseDetail } from '../../api/growth';
import {
  findQueuedResponseCreate, findQueuedResponseUpdate, isQueuedResult, persistResponseResilient,
} from '../../offline/submit';
import { vaultClear, vaultKey, vaultLoad, vaultSave } from '../../offline/answerVault';
import { afterGrowthCheck, nextInFlow, parseFlow } from '../../lib/careFlow';
import type { FlatField, FlatSchema, FormDefinition, FormKey } from '../../lib/flowTypes';
import { isExclusiveOption, isMotherFormKey, OTHER_OPTION_VALUE } from '../../lib/flowTypes';
import { autoRisks, motherAgeOn, withAutoRisks } from '../../lib/autoAnswers';
import {
  buildFlatAnswersPayload,
  buildFlatZodSchema,
  emptyFlatValues,
  flatSchemaKeys,
  isChoiceField,
  otherTextKey,
  visibleFlatFields,
  visibleOptions,
  type FlatFormValues,
} from '../../lib/flatForm';
import { toFieldErrors } from '../../lib/validation';
import { optionLabel, useFormText } from '../../lib/formText';
import { formFlowChain } from '../../lib/formNames';
import { apiErrorMessage, formatDisplayDate, todayIso } from '../../components/assessments/flowRunner';
import ChildChip from '../../components/assessments/ChildChip';
import FlatFieldInput from '../../components/assessments/FlatFieldInput';
import MeasurementCheckNotice from '../../components/assessments/MeasurementCheckNotice';
import { useMeasurementCheck } from '../../hooks/useMeasurementCheck';

/** The growth check's weight and length fields, found as the server finds them
 *  (routers/growth._extract_metrics): a number field named for weight, or for
 *  length / height. The form is admin-editable, so not by a fixed id. */
const measureFieldIds = (fields: FlatField[]) => {
  const find = (re: RegExp, not?: RegExp) => fields.find(f => {
    const key = `${f.id} ${f.label ?? ''}`.toLowerCase();
    return f.type === 'number' && re.test(key) && !(not && not.test(key));
  })?.id ?? null;
  return { weight: find(/weight/), length: find(/length|height/, /weight/) };
};

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

/** The antenatal question whose height/age answers come from the registration. */
const RISK_FIELD = 'high_risk_conditions';
/** The growth check's "where was it measured" — remembered from the last check. */
const LOCATION_FIELD = 'measurement_location';

/** One screen: a field, and the read-only computed fields that follow it. */
interface Step { field: FlatField; extras: FlatField[] }

const FlatAssessmentRunnerPage: React.FC = () => {
  const { motherId: motherParam, childId: childParam, formKey: keyParam } = useParams();
  const motherId = Number(motherParam);
  const childId = Number(childParam);
  const formKey = (keyParam ?? 'growth_monitoring') as FormKey;
  /** Mother-level flat forms (antenatal) have no child in scope. */
  const motherLevel = isMotherFormKey(formKey);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation('assessments');
  const { showToast } = useToast();
  const words = useFormText(formKey);

  const resumeIdParam = searchParams.get('responseId');
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;
  /** A guided run of forms (lib/careFlow): what comes after this one. */
  const flow = parseFlow(searchParams.get('flow'));

  const historyUrl = motherLevel
    ? `/mothers/${motherId}/assessments/${formKey}`
    : `/mothers/${motherId}/children/${childId}/assessments/${formKey}`;
  const today = useRef(todayIso()).current;

  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [mother, setMother] = useState<Mother | null>(null);
  /** Latest previously SUBMITTED weight (kg) — the weight-gain baseline. */
  const [previousWeight, setPreviousWeight] = useState<number | null>(null);
  /** The baby's last growth check, shown as a hint beside the weight and length. */
  const [lastCheck, setLastCheck] = useState<{ date: string; weight: number | null; length: number | null } | null>(null);
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
  const [stepIndex, setStepIndex] = useState(0);
  /** Every answer listed before submitting, each with a pen. */
  const [reviewing, setReviewing] = useState(false);
  /** Came from the review list to change one answer: Next goes back to it. */
  const [returnToReview, setReturnToReview] = useState(false);

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

  /** The screens: each answerable field, with the computed fields after it. */
  const steps: Step[] = useMemo(() => {
    const out: Step[] = [];
    for (const f of visible) {
      if (f.computed && out.length > 0) out[out.length - 1].extras.push(f);
      else out.push({ field: f, extras: [] });
    }
    return out;
  }, [visible]);

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
              const saved = ans.selected ? ans.selected.map(s => s.optionId) : (ans.optionIds ?? []);
              // Drop options the form no longer defines. A draft saved before
              // the admin edited the form can name a deleted option: it renders
              // as nothing selected, but would still be POSTed — and the server
              // rejects undefined option ids. On a checkbox there is no longer
              // a tickbox to clear it with, so the learner would be stuck.
              const allowed = new Set((f.options ?? []).map(o => o.value));
              if (f.allowOther) allowed.add(OTHER_OPTION_VALUE);
              const ids = allowed.size > 0 ? saved.filter(id => allowed.has(id)) : saved;
              next[f.id] = f.type === 'checkbox' ? ids : (ids[0] ?? '');
              // A semi-open answer stores its typed text in `value`; put it
              // back in the "Other" box so an edit resumes where it left off.
              if (f.allowOther && ids.includes(OTHER_OPTION_VALUE)) {
                next[otherTextKey(f.id)] = ans.value ?? '';
              }
            } else {
              next[f.id] = ans.value ?? '';
            }
          }
        };

        // The vault/coalescing identity of this visit: server row, queued
        // offline creation's temp id, or null for a brand-new visit.
        let effectiveId: number | string | null = null;
        let fresh = false;

        if (resp) {
          setEditingSubmitted(resp.status === 'submitted');
          // A submitted form opens on its answers, each with a pen.
          if (resp.status === 'submitted') setReviewing(true);
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
          } else {
            fresh = true;
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
          fresh = false;
          showToast(t('restoredAnswers', { ns: 'offline' }), 'info');
        }
        setValues(next);

        // A new growth check: the last one's numbers as hints, and where it
        // was measured, remembered (Learner Redesign review: "location
        // remembered from last time, previous values shown as hints").
        if (!motherLevel && formKey === 'growth_monitoring' && resumeId == null) {
          getMyGrowthCaseDetail(childId)
            .then(d => {
              const l = d.status?.latest;
              if (!cancelled && l) setLastCheck({ date: l.date, weight: l.weight, length: l.length });
            })
            .catch(() => { /* hints are a bonus */ });
          if (fresh && defFields.some(f => f.id === LOCATION_FIELD)) {
            listChildResponses(formKey, childId)
              .then(rows => rows.filter(r => r.status === 'submitted')
                .sort((a, b) => (a.assessment_date < b.assessment_date ? 1 : -1))[0])
              .then(lastRow => (lastRow ? getResponse(lastRow.id) : null))
              .then(full => {
                const ans = full?.answers_json?.find(a => a.nodeId === LOCATION_FIELD);
                const picked = ans?.selected?.[0]?.optionId;
                if (cancelled || !picked || picked === OTHER_OPTION_VALUE) return;
                setValues(prev => (prev[LOCATION_FIELD] ? prev : { ...prev, [LOCATION_FIELD]: picked }));
              })
              .catch(() => { /* remembered location is a bonus */ });
          }
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

  // ── Answers the registration already gives (antenatal high-risk) ───────────
  // Short stature, under 18 and over 35 come from the mother's height and age
  // (review of 30 Oct 2026); the learner answers the rest.
  const riskField = useMemo(
    () => (formKey === 'antenatal' ? fields.find(f => f.id === RISK_FIELD) ?? null : null),
    [formKey, fields],
  );
  const autos = useMemo(
    () => (riskField && mother
      ? autoRisks(riskField.options ?? [], mother.height ?? null, motherAgeOn(mother.mother_dob, mother.mother_age, assessmentDate))
      : []),
    [riskField, mother, assessmentDate],
  );
  const autoValues = useMemo(() => new Set(autos.map(a => a.value)), [autos]);
  /** The learner's own ticks: what is checked and shown. */
  const tickedValues = useMemo(() => {
    if (autos.length === 0) return values;
    const ticked = Array.isArray(values[RISK_FIELD]) ? (values[RISK_FIELD] as string[]) : [];
    return { ...values, [RISK_FIELD]: ticked.filter(v => !autoValues.has(v)) };
  }, [values, autos, autoValues]);
  /** What is stored: the ticks plus what the registration identifies. */
  const storedValues = useMemo(() => {
    if (!riskField || autos.length === 0) return values;
    const exclusive = new Set((riskField.options ?? []).filter(isExclusiveOption).map(o => o.value));
    return { ...values, [RISK_FIELD]: withAutoRisks(tickedValues[RISK_FIELD] as string[], autos, exclusive) };
  }, [values, tickedValues, riskField, autos]);

  // ── Checked as answered (review of 30 Oct 2026: "this flagging should happen
  // immediately when they try to fill this", not only on Submit) ─────────────
  const validationSubset = (): FlatFormValues => {
    const subset: FlatFormValues = {};
    // Computed fields are read-only text — they never block submission.
    // Only visible fields are in the schema, so parse only those keys.
    for (const f of visible) subset[f.id] = tickedValues[f.id] ?? (f.type === 'checkbox' ? [] : '');
    // Semi-open fields also carry an "Other" text slot the schema validates.
    for (const key of flatSchemaKeys(visible)) {
      if (!(key in subset)) subset[key] = tickedValues[key] ?? '';
    }
    return subset;
  };
  const liveErrors = useMemo(() => {
    const result = buildFlatZodSchema(fields, tickedValues, { t, ageDays, dobIso: child?.dob ?? null })
      .safeParse(validationSubset());
    return result.success ? {} : toFieldErrors(result);
    // validationSubset reads the same inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, tickedValues, visible, ageDays, child?.dob, t]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (id: string) => setTouched(prev => (prev[id] ? prev : { ...prev, [id]: true }));
  const shownError = (id: string): string | undefined => errors[id] || (touched[id] ? liveErrors[id] : undefined) || undefined;

  // ── Measurement checks (visit protocol, Nov 2026): asked right after the
  // weight or length is entered — measure again, or confirm it is right. The
  // save is never blocked for a confirmed value. ─────────────────────────────
  const isGrowth = formKey === 'growth_monitoring' && !motherLevel;
  const measureIds = useMemo(() => measureFieldIds(fields), [fields]);
  const shownValue = (id: string | null) =>
    id && visible.some(f => f.id === id) && typeof values[id] === 'string' ? (values[id] as string) : '';
  const check = useMeasurementCheck({
    childId: isGrowth ? childId : null,
    responseId: typeof responseId === 'number' ? responseId : null,
    assessmentDate,
    weight: shownValue(measureIds.weight),
    length: shownValue(measureIds.length),
    live: isGrowth && [measureIds.weight, measureIds.length].some(id => !!id && touched[id]),
  });

  const setValue = (id: string, v: string | string[]) => {
    setValues(prev => ({ ...prev, [id]: v }));
    setErrors(prev => (prev[id] ? { ...prev, [id]: '' } : prev));
    // A choice is an answer the moment it is made; typed answers are checked
    // when the field is left (onBlur), so typing "5" on the way to "58" is fine.
    const field = fields.find(f => f.id === id);
    if (field && ['radio', 'checkbox', 'dropdown', 'date', 'image'].includes(field.type)) touch(id);
  };
  const remeasure = (id: string) => {
    setValue(id, '');
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  };

  // Offline-resilient: with no network the submission lands in the local sync
  // queue instead of failing (see src/offline/).
  const subjectLabel =
    `${t(`forms.${formKey}`, { ns: 'assessments', defaultValue: formKey })}` +
    ` — ${child?.child_name ?? mother?.mother_name ?? ''}`;

  const persist = async (status: 'draft' | 'submitted') => {
    const answers = buildFlatAnswersPayload(fields, storedValues, ageDays);
    const payload = {
      assessment_date: assessmentDate, status, answers,
      // Which measurement-check flags the learner confirmed as right; the
      // server recomputes the flags and records both with the response.
      ...(isGrowth && check.confirmed.length ? { confirmed_checks: check.confirmed } : {}),
    };
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

  /** The screen a field (or its "Other" text) is on. */
  const stepOf = (key: string): number => steps.findIndex(s => s.field.id === key.replace(/__other$/, ''));
  /** Open one screen to fix it; Next goes back to the answers. */
  const showStep = (at: number) => {
    if (at < 0) return;
    setReviewing(false);
    setReturnToReview(true);
    setStepIndex(at);
  };

  const handleSubmit = async () => {
    const schema = buildFlatZodSchema(fields, tickedValues, { t, ageDays, dobIso: child?.dob ?? null });
    const result = schema.safeParse(validationSubset());
    if (!result.success) {
      const fieldErrors = toFieldErrors(result);
      setErrors(fieldErrors);
      showToast(t('growth.fixErrors'), 'error');
      const firstId = Object.keys(fieldErrors)[0];
      if (firstId) showStep(stepOf(firstId));
      return;
    }
    setErrors({});
    setSubmitting(true);
    if (isGrowth) {
      // A flagged weight or length is asked about once more before the save:
      // measure again or confirm. Offline the check is skipped.
      const open = await check.flush();
      if (open.length > 0) {
        setSubmitting(false);
        showToast(t('checks.mustConfirm'), 'error');
        const id = open[0].field === 'weight' ? measureIds.weight : measureIds.length;
        if (id) showStep(stepOf(id));
        return;
      }
    }
    try {
      const saved = await persist('submitted');
      const queued = isQueuedResult(saved);
      showToast(queued ? t('runner.submittedOffline', { ns: 'offline' }) : t('growth.submitted'), 'success');
      // A growth check opens the baby's chart at once (launch review of 19 Oct
      // 2026); offline there is no new point to show, so the next form of the
      // visit follows instead. Any other form goes on with the visit.
      const kid = motherLevel ? null : childId;
      navigate(
        formKey === 'growth_monitoring' && !queued ? afterGrowthCheck(childId, flow)
          : flow && (!queued || flow.rest.length) ? nextInFlow(flow, motherId, kid)
          : historyUrl,
        { replace: true },
      );
    } catch (err) {
      showToast(apiErrorMessage(err) ?? t('growth.saveFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Moving between screens ─────────────────────────────────────────────────
  const last = Math.max(0, steps.length - 1);
  const index = Math.min(stepIndex, last);
  const current: Step | undefined = steps[index];

  const goNext = async () => {
    if (!current) return;
    const f = current.field;
    const keys = [f.id, otherTextKey(f.id)];
    keys.forEach(touch);
    if (keys.some(k => liveErrors[k])) return;
    // The weight and length screens ask the measurement check before moving
    // on: "weigh again", or "weight is correct" (Learner Redesign mockup).
    if (isGrowth && (f.id === measureIds.weight || f.id === measureIds.length)) {
      const which = f.id === measureIds.weight ? 'weight' : 'length';
      const open = (await check.flush()).filter(x => x.field === which);
      if (open.length > 0) return;
    }
    if (returnToReview) { setReturnToReview(false); setReviewing(true); return; }
    if (index >= last) { setReviewing(true); return; }
    setStepIndex(index + 1);
    window.scrollTo({ top: 0 });
  };
  const goBack = () => {
    if (reviewing) { setReviewing(false); setStepIndex(last); return; }
    if (index > 0) { setStepIndex(index - 1); return; }
    navigate(historyUrl);
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

  if (fields.length === 0 || !current) {
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
  const lang = i18n.language;
  /** A field as the learner reads it: her language first, options filtered by age. */
  const shownField = (field: FlatField): FlatField => {
    const options = visibleOptions(field, values, ageDays)?.map(o => ({
      ...o, label: optionLabel(words.option(field.id, o.value, o.label)),
    })) ?? null;
    return {
      ...field,
      label: words.title(field.id, field.label).main,
      helpText: field.helpText ? words.help(field.id, field.helpText).main : field.helpText,
      options,
    };
  };
  /** One line per answer for the review list. */
  const answerText = (field: FlatField): string => {
    const v = storedValues[field.id];
    if (isChoiceField(field)) {
      const picked = Array.isArray(v) ? v : v ? [v] : [];
      return picked.map(p => (p === OTHER_OPTION_VALUE
        ? String(values[otherTextKey(field.id)] ?? '') || t('growth.otherOption')
        : words.option(field.id, p, field.options?.find(o => o.value === p)?.label ?? p).main)).join(', ');
    }
    if (field.type === 'date') return typeof v === 'string' && v ? formatDisplayDate(v, lang) : '';
    if (field.type === 'image') return typeof v === 'string' && v ? t('growth.photoAdded') : '';
    return typeof v === 'string' ? v : '';
  };
  const answered = (field: FlatField) => answerText(field).trim().length > 0;
  const chain = formFlowChain(formKey, flow?.rest ?? [], t);
  const progressPct = steps.length ? (reviewing ? 100 : (index / steps.length) * 100) : 0;

  const f = current.field;
  const fieldShown = shownField(f);
  const fWords = words.title(f.id, f.label);
  const helpWords = f.helpText ? words.help(f.id, f.helpText) : null;
  const measure: 'weight' | 'length' | null = isGrowth && f.id === measureIds.weight ? 'weight'
    : isGrowth && f.id === measureIds.length ? 'length' : null;
  const isRiskStep = f.id === RISK_FIELD && autos.length > 0;
  const inputField: FlatField = isRiskStep
    ? { ...fieldShown, options: (fieldShown.options ?? []).filter(o => !autoValues.has(o.value)) }
    : fieldShown;
  // Danger signs are listed apart (Learner Redesign review: "they should be
  // asked separately and should trigger a referral message") but stay one answer.
  const dangerOpts = f.type === 'checkbox' ? (inputField.options ?? []).filter(o => o.danger) : [];
  const plainOpts = dangerOpts.length ? (inputField.options ?? []).filter(o => !o.danger) : null;
  const pickedNow = Array.isArray(tickedValues[f.id]) ? (tickedValues[f.id] as string[]) : [];
  const isDanger = (v: string) => dangerOpts.some(o => o.value === v);
  const dangerPicked = pickedNow.some(isDanger);
  const exclusiveValues = new Set((inputField.options ?? []).filter(isExclusiveOption).map(o => o.value));

  return (
    <div className="flex flex-col">
      {/* Sticky top: Back, the form and whom it is for, the counter, Exit */}
      <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-6 border-b border-border bg-background px-5 pb-3 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={busy}
              aria-label={t('runner.back')}
              className="-ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-sm font-semibold text-ink">{chain.current ?? definition.title}</div>
              <div className="truncate text-xs text-ink-muted">
                {motherLevel ? mother?.mother_name : child?.child_name}
                {chain.next.length > 0 && <span> · {t('flow.then', { forms: chain.next.join(' → ') })}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-semibold tabular-nums text-ink-muted">
                {reviewing ? t('runner.reviewCounter') : t('runner.stepCounter', { current: index + 1, total: steps.length })}
              </span>
              <button
                type="button"
                onClick={() => navigate(historyUrl)}
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

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-6">
        {motherLevel && mother?.lmp == null && (
          <Alert variant="warning" title={t('anc.noLmp')} />
        )}
        {!motherLevel && child && child.dob == null && (
          <Alert variant="warning" title={t('growth.noDobTitle')}>
            {t('growth.noDobBody')}
          </Alert>
        )}
        {!motherLevel && child && index === 0 && !reviewing && (
          <ChildChip name={child.child_name} uid={child.child_uid} ageDays={child.age_days} ageMonths={child.age_months} />
        )}

        {reviewing ? (
          <Card className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
              <ListChecks className="size-5 text-primary-ink" />{t('runner.reviewTitle')}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{t('runner.reviewHint')}</p>
            <ol className="mt-4 flex flex-col divide-y divide-border">
              {steps.map((s, i) => {
                const err = errors[s.field.id] || liveErrors[s.field.id];
                const missing = s.field.required && !answered(s.field) && !s.field.computed;
                return (
                  <li key={s.field.id}>
                    <button type="button" onClick={() => showStep(i)}
                      className="flex w-full cursor-pointer items-start gap-3 py-3 text-left hover:bg-surface-sunken/60">
                      <span className="mt-0.5 w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-muted">{i + 1}.</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{words.title(s.field.id, s.field.label).main}</span>
                        <span className={missing || err ? 'block text-sm font-semibold text-error-600 dark:text-error-400' : 'block text-sm text-ink-muted'}>
                          {s.field.computed ? (computedValues[s.field.id] || '—')
                            : err && !answered(s.field) ? (s.field.required ? t('runner.notAnswered') : t('runner.skipped'))
                              : err || (answered(s.field) ? answerText(s.field) : s.field.required ? t('runner.notAnswered') : t('runner.skipped'))}
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
          <Card key={f.id} className="flex flex-col gap-4 p-6 sm:p-8">
            <div className="text-center">
              <h2 className="text-balance font-display text-xl font-semibold text-ink sm:text-2xl">{fWords.main}</h2>
              {fWords.english && <p className="mt-1 text-sm text-ink-muted" lang="en">{fWords.english}</p>}
              {helpWords?.main && <p className="mt-2 text-sm text-ink-muted">{helpWords.main}</p>}
              {!f.required && !f.computed && <p className="mt-2 text-xs text-ink-faint">{t('runner.optionalHint')}</p>}
            </div>

            {isRiskStep && mother && (
              <div className="rounded-lg border border-border bg-surface-sunken/60 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <ShieldCheck className="size-4 text-primary-ink" />{t('anc.autoTitle')}
                </p>
                <p className="mb-2 mt-0.5 text-xs text-ink-muted">
                  {t('anc.autoFrom', {
                    height: mother.height != null ? `${mother.height} cm` : '—',
                    age: motherAgeOn(mother.mother_dob, mother.mother_age, assessmentDate) ?? '—',
                  })}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {autos.map(a => (
                    <li key={a.value} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink">{words.option(RISK_FIELD, a.value, a.label).main}</span>
                      <span className={a.applies ? 'font-semibold text-error-600 dark:text-error-400'
                        : a.applies === false ? 'font-semibold text-success-600 dark:text-success-500' : 'text-ink-muted'}>
                        {a.applies ? t('anc.yes') : a.applies === false ? t('anc.no') : t(`anc.unknown.${a.basis}`)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm font-semibold text-ink">{t('anc.otherRisks')}</p>
              </div>
            )}

            {f.computed ? (
              <div className="rounded-lg border border-dashed border-border-strong/70 bg-surface-sunken/50 px-3.5 py-2.5 text-center text-sm font-semibold text-ink">
                {computedValues[f.id] || '—'}
              </div>
            ) : (
              <div className={f.type === 'number' || f.type === 'date' || f.type === 'text' ? 'mx-auto w-full max-w-xs' : undefined}>
                <FlatFieldInput
                  field={plainOpts ? { ...inputField, options: plainOpts } : inputField}
                  value={plainOpts ? pickedNow.filter(v => !isDanger(v)) : (tickedValues[f.id] ?? (f.type === 'checkbox' ? [] : ''))}
                  onChange={v => {
                    if (plainOpts && Array.isArray(v)) {
                      // "None" clears the danger signs too; anything else keeps them.
                      const keepDanger = !v.some(x => exclusiveValues.has(x));
                      setValue(f.id, [...v, ...(keepDanger ? pickedNow.filter(isDanger) : [])]);
                    } else setValue(f.id, v);
                  }}
                  onBlur={() => { touch(f.id); touch(otherTextKey(f.id)); }}
                  error={shownError(f.id)}
                  otherText={String(values[otherTextKey(f.id)] ?? '')}
                  onOtherTextChange={v => setValue(otherTextKey(f.id), v)}
                  otherError={shownError(otherTextKey(f.id))}
                  disabled={busy}
                  dobIso={child?.dob ?? null}
                  todayIso={today}
                  hideLabel
                />
              </div>
            )}

            {f.id === dateFieldId && !values[f.id] && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" iconLeft={<CalendarCheck className="size-4" />} onClick={() => setValue(f.id, today)}>
                  {t('growth.today')}
                </Button>
              </div>
            )}

            {plainOpts && (
              <div className="rounded-lg border-2 border-error-300 bg-error-50/60 p-3.5 dark:border-error-500/40 dark:bg-error-500/10">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-error-700 dark:text-error-300">
                  <AlertTriangle className="size-4" />{t('anc.danger.groupTitle')}
                </p>
                <FlatFieldInput
                  field={{ ...inputField, id: `${f.id}__danger`, options: dangerOpts, allowOther: false }}
                  value={pickedNow.filter(isDanger)}
                  onChange={v => {
                    const chosen = Array.isArray(v) ? v : [];
                    // A danger sign ticked: "None" no longer holds.
                    const plain = pickedNow.filter(x => !isDanger(x) && !(chosen.length > 0 && exclusiveValues.has(x)));
                    setValue(f.id, [...plain, ...chosen]);
                  }}
                  disabled={busy}
                  todayIso={today}
                  hideLabel
                />
              </div>
            )}
            {dangerPicked && (
              <Alert variant="error" title={t('anc.danger.alertTitle')}>{t('anc.danger.alert')}</Alert>
            )}

            {measure && lastCheck && lastCheck[measure] != null && (
              <p className="flex items-center justify-center gap-1.5 text-sm text-ink-muted">
                <History className="size-4" />
                {t('growth.lastVisit', {
                  date: formatDisplayDate(lastCheck.date, lang),
                  value: measure === 'weight' ? `${lastCheck.weight} kg` : `${lastCheck.length} cm`,
                })}
              </p>
            )}
            {f.id === LOCATION_FIELD && values[f.id] && !touched[f.id] && resumeId == null && (
              <p className="text-center text-xs text-ink-muted">{t('growth.samePlace')}</p>
            )}
            {measure && (
              <MeasurementCheckNotice
                field={measure}
                flags={check.flags.filter(x => x.field === measure)}
                confirmed={check.confirmed}
                onRemeasure={() => remeasure(f.id)}
                onConfirm={() => check.confirm(measure)}
              />
            )}

            {current.extras.map(x => (
              <div key={x.id} id={x.id}>
                <span className="mb-1.5 block text-sm font-semibold text-ink">{words.title(x.id, x.label).main}</span>
                <div className="rounded-lg border border-dashed border-border-strong/70 bg-surface-sunken/50 px-3.5 py-2.5 text-sm font-semibold text-ink">
                  {computedValues[x.id] || '—'}
                </div>
                {x.helpText && <p className="mt-1 text-xs text-ink-muted">{words.help(x.id, x.helpText).main}</p>}
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* Footer: fixed at the bottom so Next never moves (review of 30 Oct 2026). */}
      <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-background px-5 py-3 sm:-mx-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 sm:gap-3">
          {!editingSubmitted && (
            <Button variant="ghost" onClick={handleSaveDraft} loading={saving} disabled={submitting} className="ml-auto">
              {t('growth.saveDraft')}
            </Button>
          )}
          {reviewing ? (
            <Button size="lg" onClick={handleSubmit} loading={submitting} disabled={saving}
              iconLeft={<CheckCircle2 className="size-4" />} className={editingSubmitted ? 'ml-auto' : undefined}>
              {editingSubmitted ? t('runner.saveChanges') : t('runner.confirmSubmit')}
            </Button>
          ) : (
            <Button size="lg" onClick={() => { void goNext(); }} disabled={busy}
              iconRight={<ArrowRight className="size-4" />} className={editingSubmitted ? 'ml-auto' : undefined}>
              {returnToReview ? t('runner.backToReview') : index >= last ? t('runner.review') : t('runner.next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FlatAssessmentRunnerPage;
