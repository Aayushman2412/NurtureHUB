import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Bell, CornerDownRight, Film, Flag, GitBranch, Info, Link2, OctagonMinus, Printer,
} from 'lucide-react';
import { adminGetForm } from '../../../api/forms';
import {
  formatTimestamp, reachableNodeIds, resolveAssetUrl,
} from '../../../lib/flowGraph';
import {
  FORM_KEYS, findVerdict, isInfoNode, isMatrixNode, isQuestionNode, isSectionNode, resolveVerdicts,
} from '../../../lib/flowTypes';
import type {
  FlatField, FlatSchema, FlowAction, FlowInfoNode, FlowMatrixNode, FlowNode, FlowOption,
  FlowQuestionNode, FlowSchema, FlowSectionChild, FormDefinition, FormKey, NumericRange, VerdictDef,
} from '../../../lib/flowTypes';
import VerdictChip from '../../../components/assessments/VerdictChip';
import MatrixStepCard from '../../../components/assessments/MatrixStepCard';
import FlatFieldInput from '../../../components/assessments/FlatFieldInput';
import { Badge, Button, PageLoader } from '../../../components/ui';
import { cn } from '../../../utils/cn';

/**
 * Print-ready, learner-faithful preview of a whole form: every step laid out
 * top-to-bottom exactly as the learner runner styles it, plus small grey
 * ADMIN-ONLY annotation chips (skip logic, verdicts, flag ranges, visibility
 * conditions) that learners never see. "Save as PDF" uses the browser's
 * native print dialog — real fonts, real colors, real images.
 */

/** Small grey annotation chip — admin metadata, visually distinct from learner UI. */
const Anno: React.FC<{ icon?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  icon,
  children,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong/70',
      'bg-surface-sunken/60 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-muted',
      className,
    )}
  >
    {icon}
    {children}
  </span>
);

const numericLabel = (numeric: NumericRange | null | undefined): string | null => {
  if (!numeric) return null;
  const parts: string[] = [];
  if (numeric.decimals != null) parts.push(`up to ${numeric.decimals} decimal${numeric.decimals === 1 ? '' : 's'}`);
  if (numeric.flagMin != null || numeric.flagMax != null) {
    const lo = numeric.flagMin != null ? numeric.flagMin : '−∞';
    const hi = numeric.flagMax != null ? numeric.flagMax : '∞';
    parts.push(`flagged outside ${lo}–${hi}`);
  }
  return parts.length ? parts.join(' • ') : null;
};

const actionLabel = (a: FlowAction): { icon: React.ReactNode; text: string } | null => {
  if (!a || a.type === 'none') return null;
  const clip =
    a.startSeconds != null && a.endSeconds != null
      ? ` (${formatTimestamp(a.startSeconds)}–${formatTimestamp(a.endSeconds)})`
      : a.startSeconds != null
        ? ` (from ${formatTimestamp(a.startSeconds)})`
        : '';
  switch (a.type) {
    case 'youtube':
      return { icon: <Film className="size-3" />, text: `YouTube${clip}: ${a.url}` };
    case 'video':
      return { icon: <Film className="size-3" />, text: `Video${clip}: ${a.url}` };
    case 'notify':
      return { icon: <Bell className="size-3" />, text: `Notification: ${a.message}` };
    case 'info':
      return { icon: <Info className="size-3" />, text: a.message || a.url };
    default:
      return null;
  }
};

/** Static learner-style option tile (mirrors OptionCard, non-interactive). */
const OptionTile: React.FC<{
  option: FlowOption;
  verdictDef: VerdictDef | null;
  branchNote: string | null;
}> = ({ option, verdictDef, branchNote }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const media = option.media[0];
  const initial = (option.label.trim()[0] ?? '?').toUpperCase();
  const action = actionLabel(option.action);

  return (
    <div className="flex break-inside-avoid flex-col overflow-hidden rounded-xl border-2 border-border bg-surface">
      {media && !imgFailed ? (
        <img
          src={resolveAssetUrl(media.url)}
          alt=""
          onError={() => setImgFailed(true)}
          className="aspect-video w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-coral-50 to-cream-200"
        >
          <span className="font-display text-4xl font-bold text-coral-300">{initial}</span>
        </div>
      )}
      <div className="flex flex-1 flex-col items-start gap-1.5 p-3">
        <span className="text-sm font-semibold leading-snug text-ink">{option.label}</span>
        <span className="flex flex-wrap items-center gap-1">
          {verdictDef && <VerdictChip def={verdictDef} />}
          {branchNote && <Anno icon={<GitBranch className="size-3" />}>{branchNote}</Anno>}
          {action && <Anno icon={action.icon}>{action.text}</Anno>}
        </span>
      </div>
    </div>
  );
};

/** Learner-style question card (used for both top-level questions and section children). */
const QuestionBlock: React.FC<{
  question: FlowQuestionNode | FlowSectionChild;
  label: string;
  verdicts: VerdictDef[];
  stepNoFor: (id: string | null) => string | null;
  defaultNextId?: string | null;
}> = ({ question, label, verdicts, stepNoFor, defaultNextId }) => {
  const numeric = numericLabel(question.numeric);
  return (
    <div className="break-inside-avoid rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-card)">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Badge variant="coral">{label}</Badge>
        <Anno>{question.questionType}</Anno>
        {question.required && <Anno>required</Anno>}
        {numeric && <Anno icon={<Flag className="size-3" />}>{numeric}</Anno>}
      </div>
      <h3 className="font-display text-lg font-bold text-ink">{question.title || 'Untitled question'}</h3>
      {question.helpText?.trim() && <p className="mt-1 text-sm text-ink-muted">{question.helpText}</p>}

      {(question.media ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {(question.media ?? []).map((m, i) => (
            <img
              key={i}
              src={resolveAssetUrl(m.url)}
              alt=""
              className="h-32 rounded-lg border border-border object-cover"
            />
          ))}
        </div>
      )}

      {question.options.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {question.options.map(option => {
            const branchTo =
              option.next && option.next !== (defaultNextId ?? null) ? stepNoFor(option.next) : null;
            return (
              <OptionTile
                key={option.id}
                option={option}
                verdictDef={findVerdict(verdicts, option.verdict)}
                branchNote={branchTo ? `skips to ${branchTo}` : null}
              />
            );
          })}
        </div>
      )}

      {question.questionType === 'text' && (
        <div className="mt-4 h-16 rounded-lg border border-border bg-surface-sunken/40" aria-hidden />
      )}
      {(question.questionType === 'number' || question.questionType === 'date') && (
        <div className="mt-4 h-10 w-56 rounded-lg border border-border bg-surface-sunken/40" aria-hidden />
      )}
    </div>
  );
};

/** Static learner-style info block (InfoStepCard without the live video embed). */
const InfoBlock: React.FC<{ node: FlowInfoNode; label: string }> = ({ node, label }) => {
  const action = actionLabel(node.action);
  return (
    <div className="break-inside-avoid rounded-2xl border border-primary/25 bg-coral-50/40 p-5 dark:bg-coral-500/5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Badge variant="coral">{label}</Badge>
        <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary">
          <Info className="size-3.5" /> Info — no answer collected
        </span>
      </div>
      {node.title.trim() && <h3 className="font-display text-lg font-bold text-ink">{node.title}</h3>}
      {node.body.trim() && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{node.body}</p>}
      {node.media.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {node.media.map((m, i) => (
            <img key={i} src={resolveAssetUrl(m.url)} alt="" className="h-32 rounded-lg border border-border object-cover" />
          ))}
        </div>
      )}
      {action && (
        <p className="mt-3">
          <Anno icon={<Link2 className="size-3" />}>{action.text}</Anno>
        </p>
      )}
    </div>
  );
};

const FlowPrint: React.FC<{ schema: FlowSchema }> = ({ schema }) => {
  const verdicts = resolveVerdicts(schema.verdicts);

  const ordered: FlowNode[] = useMemo(() => {
    const ids = [...reachableNodeIds(schema)];
    return ids.map(id => schema.nodes[id]).filter((n): n is FlowNode => !!n);
  }, [schema]);

  const stepNo = useMemo(() => {
    const map = new Map<string, number>();
    ordered.forEach((n, i) => map.set(n.id, i + 1));
    return map;
  }, [ordered]);

  const stepNoFor = (id: string | null): string | null =>
    id && stepNo.has(id) ? `Step ${stepNo.get(id)}` : null;

  const unreachable = useMemo(
    () => Object.values(schema.nodes).filter(n => !stepNo.has(n.id)),
    [schema, stepNo],
  );

  return (
    <>
      {/* Verdict legend */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">Verdicts:</span>
        {verdicts.map(v => (
          <VerdictChip key={v.id} def={v} />
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {ordered.map((node, index) => {
          const label = `Step ${index + 1}`;
          const following = ordered[index + 1]?.id ?? null;
          const nextChips: React.ReactNode[] = [];
          if (node.next === null && index < ordered.length - 1) {
            nextChips.push(
              <Anno key="end" icon={<OctagonMinus className="size-3" />}>
                ends the form here
              </Anno>,
            );
          } else if (node.next && node.next !== following) {
            nextChips.push(
              <Anno key="jump" icon={<CornerDownRight className="size-3" />}>
                then continues at {stepNoFor(node.next)}
              </Anno>,
            );
          }

          return (
            <div key={node.id}>
              {isQuestionNode(node) && (
                <QuestionBlock
                  question={node}
                  label={label}
                  verdicts={verdicts}
                  stepNoFor={stepNoFor}
                  defaultNextId={node.next}
                />
              )}

              {isSectionNode(node) && (
                <div className="break-inside-avoid-page rounded-2xl border border-sage-500/40 bg-sage-50/40 p-4 dark:bg-sage-500/5">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="coral">{label}</Badge>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-sage-700 dark:text-sage-300">
                      Common section — {node.title || 'Untitled'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-4">
                    {node.children.map((child, ci) => (
                      <QuestionBlock
                        key={child.id}
                        question={child}
                        label={`${index + 1}.${ci + 1}`}
                        verdicts={verdicts}
                        stepNoFor={stepNoFor}
                      />
                    ))}
                  </div>
                </div>
              )}

              {isInfoNode(node) && <InfoBlock node={node} label={label} />}

              {isMatrixNode(node) && (
                <div className="break-inside-avoid rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-card)">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="coral">{label}</Badge>
                    {node.required && <Anno>required</Anno>}
                  </div>
                  <MatrixStepCard node={node as FlowMatrixNode} value={{}} onChange={() => {}} />
                </div>
              )}

              {nextChips.length > 0 && <p className="mt-1.5 pl-2">{nextChips}</p>}
            </div>
          );
        })}
      </div>

      {unreachable.length > 0 && (
        <div className="mt-8 break-inside-avoid rounded-xl border border-dashed border-border-strong p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Not reachable from the start — learners never see these
          </p>
          <ul className="mt-1.5 list-inside list-disc text-sm text-ink-muted">
            {unreachable.map(n => (
              <li key={n.id}>{('title' in n && n.title) || n.id}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
};

const flatConditionLabel = (field: FlatField): string | null => {
  if (!field.showIf?.length) return null;
  const parts = field.showIf.map(c => {
    if (c.kind === 'ageLtDays') return `child younger than ${c.days} days`;
    if (c.kind === 'ageGteDays') return `child at least ${c.days} days old`;
    return `"${c.fieldId}" is ${c.anyOf?.map(v => `"${v}"`).join(' or ') ?? '?'}`;
  });
  return `shown only when ${parts.join(' and ')}`;
};

const FlatPrint: React.FC<{ schema: FlatSchema }> = ({ schema }) => {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  return (
    <div className="flex flex-col gap-4">
      {schema.fields.map((field, index) => {
        const restrictions: string[] = [];
        if (field.min != null || field.max != null)
          restrictions.push(`allowed ${field.min ?? '−∞'}–${field.max ?? '∞'}`);
        const soft = numericLabel({ decimals: field.decimals, flagMin: field.flagMin, flagMax: field.flagMax });
        if (soft) restrictions.push(soft);
        if (field.noFuture) restrictions.push('no future dates');
        if (field.notBeforeDob) restrictions.push('not before date of birth');
        const condition = flatConditionLabel(field);

        return (
          <div key={field.id} className="break-inside-avoid rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-card)">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="coral">{index + 1}</Badge>
              <Anno>{field.type}</Anno>
              {field.required && <Anno>required</Anno>}
              {restrictions.map((r, i) => (
                <Anno key={i} icon={<Flag className="size-3" />}>
                  {r}
                </Anno>
              ))}
              {condition && <Anno icon={<GitBranch className="size-3" />}>{condition}</Anno>}
            </div>
            <FlatFieldInput field={field} value={field.type === 'checkbox' ? [] : ''} onChange={() => {}} disabled todayIso={todayIso} />
          </div>
        );
      })}
    </div>
  );
};

const FormPrintPage: React.FC = () => {
  const { formKey } = useParams<{ formKey: string }>();
  const navigate = useNavigate();
  const [def, setDef] = useState<FormDefinition | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');

  useEffect(() => {
    if (!formKey || !(FORM_KEYS as readonly string[]).includes(formKey)) {
      navigate('/admin/form-builder', { replace: true });
      return;
    }
    let cancelled = false;
    adminGetForm(formKey as FormKey)
      .then(d => {
        if (cancelled) return;
        setDef(d);
        setLoadState('ready');
      })
      .catch(() => !cancelled && setLoadState('error'));
    return () => {
      cancelled = true;
    };
  }, [formKey, navigate]);

  if (loadState === 'loading') return <PageLoader label="Preparing the printable form…" />;
  if (loadState === 'error' || !def)
    return (
      <div className="mx-auto max-w-3xl p-8">
        <p className="text-ink-muted">Could not load this form.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/admin/form-builder')}>
          Back to Form Builder
        </Button>
      </div>
    );

  return (
    <div className="min-h-screen bg-background print:bg-white">
      <style>{'@page { size: A4; margin: 14mm; }'}</style>

      {/* Toolbar — never printed */}
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 px-5 py-3 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<ArrowLeft className="size-4" />}
            onClick={() =>
              navigate(`/admin/form-builder/${def.builder_type === 'flow' ? 'flow' : 'flat'}/${def.form_key}`)
            }
          >
            Back
          </Button>
          <p className="flex-1 text-xs text-ink-muted">
            Learner-view preview. Dashed grey chips are admin annotations (skip logic, flags) —
            learners never see them. In the print dialog choose <strong>Save as PDF</strong>.
          </p>
          <Button size="sm" iconLeft={<Printer className="size-4" />} onClick={() => window.print()}>
            Save as PDF / Print
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        {/* Cover */}
        <div className="mb-7 border-b-2 border-primary/60 pb-5">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            NurtureHUB — questionnaire preview
          </p>
          <h1 className="mt-1 font-display text-3xl font-extrabold text-ink">{def.title}</h1>
          {def.description && <p className="mt-2 text-[15px] text-ink-muted">{def.description}</p>}
          <p className="mt-3 flex flex-wrap gap-2">
            <Badge variant="neutral">{def.builder_type === 'flow' ? 'Guided flow' : 'Field list'}</Badge>
            <Badge variant="coral">v{def.version}</Badge>
          </p>
        </div>

        {def.builder_type === 'flow' ? (
          <FlowPrint schema={def.schema_json as FlowSchema} />
        ) : (
          <FlatPrint schema={def.schema_json as FlatSchema} />
        )}

        <p className="mt-10 border-t border-border pt-3 text-center text-[11px] text-ink-faint">
          {def.title} • version {def.version} • exported from the NurtureHUB form builder
        </p>
      </main>
    </div>
  );
};

export default FormPrintPage;
