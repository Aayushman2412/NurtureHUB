/**
 * Learner runner for `flat` forms (Check Growth).
 *
 * Unlike the flow runner (one branching question per step), a flat form is a
 * single scrolling page: most of its fields are conditional, so a stepper would
 * mostly show skipped steps. Visibility, validation and the submission payload
 * come from `lib/flatForm.ts`; the server re-validates all of it.
 *
 * Convention: the first `date` field in the definition is the response's
 * `assessment_date` (Check Growth → `measurement_date`) and is prefilled with
 * today. Child age for `ageLtDays` / `ageGteDays` conditions is computed
 * against that date, not against today.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Save, Send } from 'lucide-react';
import { Alert, Button, Card, EmptyState, PageHeader, PageLoader } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { getChild, type Child } from '../../api/children';
import { createResponse, getFormDefinition, getResponse, updateResponse } from '../../api/forms';
import type { FlatField, FlatSchema, FormDefinition, FormKey } from '../../lib/flowTypes';
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

const FlatAssessmentRunnerPage: React.FC = () => {
  const { motherId: motherParam, childId: childParam, formKey: keyParam } = useParams();
  const motherId = Number(motherParam);
  const childId = Number(childParam);
  const formKey = (keyParam ?? 'growth_monitoring') as FormKey;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation('assessments');
  const { showToast } = useToast();

  const resumeIdParam = searchParams.get('responseId');
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;

  const historyUrl = `/mothers/${motherId}/children/${childId}/assessments/${formKey}`;
  const today = useRef(todayIso()).current;

  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [values, setValues] = useState<FlatFormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [responseId, setResponseId] = useState<number | null>(resumeId);
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
      getChild(motherId, childId),
      resumeId != null ? getResponse(resumeId) : Promise.resolve(null),
    ])
      .then(([def, c, resp]) => {
        if (cancelled) return;
        setDefinition(def);
        setChild(c);

        const defFields = (def.schema_json as FlatSchema | undefined)?.fields ?? [];
        const next = emptyFlatValues(defFields);

        if (resp) {
          setEditingSubmitted(resp.status === 'submitted');
          // Rehydrate a draft: snapshots keep option ids for choice fields.
          const byId = new Map(defFields.map(f => [f.id, f]));
          for (const ans of resp.answers_json ?? []) {
            const f = byId.get(ans.nodeId);
            if (!f) continue;
            if (isChoiceField(f)) {
              const ids = (ans.selected ?? []).map(s => s.optionId);
              next[f.id] = f.type === 'checkbox' ? ids : (ids[0] ?? '');
            } else {
              next[f.id] = ans.value ?? '';
            }
          }
        } else {
          const firstDate = defFields.find(f => f.type === 'date');
          if (firstDate) next[firstDate.id] = today; // spec: auto-populate today
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
  }, [formKey, motherId, childId, resumeId, today]);

  const setValue = (id: string, v: string | string[]) => {
    setValues(prev => ({ ...prev, [id]: v }));
    setErrors(prev => (prev[id] ? { ...prev, [id]: '' } : prev));
  };

  const persist = async (status: 'draft' | 'submitted') => {
    const answers = buildFlatAnswersPayload(fields, values, ageDays);
    const payload = { assessment_date: assessmentDate, status, answers };
    return responseId != null
      ? updateResponse(responseId, payload)
      : createResponse(formKey, { child_id: childId, ...payload });
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const saved = await persist('draft');
      setResponseId(saved.id);
      showToast(t('growth.draftSaved'), 'success');
    } catch (err) {
      showToast(apiErrorMessage(err) ?? t('growth.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    const schema = buildFlatZodSchema(fields, values, { t, ageDays, dobIso: child?.dob ?? null });
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
      await persist('submitted');
      showToast(t('growth.submitted'), 'success');
      navigate(historyUrl, { replace: true });
    } catch (err) {
      showToast(apiErrorMessage(err) ?? t('growth.saveFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageLoader label={t('runner.loading')} className="min-h-60" />;

  if (loadError || !definition || !child) {
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
          <ChildChip
            name={child.child_name}
            uid={child.child_uid}
            ageDays={child.age_days}
            ageMonths={child.age_months}
            className="mt-1"
          />
        }
      />

      {child.dob == null && (
        <Alert variant="warning" title={t('growth.noDobTitle')}>
          {t('growth.noDobBody')}
        </Alert>
      )}

      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        {visible.map(f => (
          <FlatFieldInput
            key={f.id}
            field={f}
            value={values[f.id] ?? (f.type === 'checkbox' ? [] : '')}
            onChange={v => setValue(f.id, v)}
            error={errors[f.id]}
            disabled={busy}
            dobIso={child.dob ?? null}
            todayIso={today}
          />
        ))}
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2 pb-4">
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
