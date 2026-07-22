import React, { useEffect, useRef } from 'react';
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  CircleDot,
  Copy,
  Flag,
  Hash,
  Info,
  Layers,
  Table,
  Trash2,
} from 'lucide-react';
import { isInfoNode, isMatrixNode, isQuestionNode } from '../../lib/flowTypes';
import type { FlowNode, QuestionType, Verdict } from '../../lib/flowTypes';
import { cn } from '../../utils/cn';
import { GRID, NODE_W, nodeTitle, truncate, verdictEdgeColor } from './constants';

const TYPE_BADGES: Record<QuestionType, { label: string; icon: React.FC<{ className?: string }>; classes: string }> = {
  single: { label: 'Single', icon: CircleDot, classes: 'bg-coral-50 text-coral-700 dark:bg-coral-500/15 dark:text-coral-300' },
  multi: { label: 'Multi', icon: CheckSquare, classes: 'bg-sage-100 text-sage-700 dark:bg-sage-500/15 dark:text-sage-300' },
  text: { label: 'Text', icon: AlignLeft, classes: 'bg-surface-sunken text-ink-muted' },
  date: { label: 'Date', icon: Calendar, classes: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-500' },
  number: { label: 'Number', icon: Hash, classes: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500' },
};

const DotMini: React.FC<{ verdict: Verdict }> = ({ verdict }) =>
  verdict === null ? (
    <span className="size-2 shrink-0 rounded-full border-[1.5px] border-ink-faint" />
  ) : (
    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: verdictEdgeColor(verdict) }} />
  );

const cardBtn =
  'flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer';

export interface FlowNodeCardProps {
  node: FlowNode;
  isStart: boolean;
  selected: boolean;
  /** True while click-to-connect is armed anywhere on the canvas. */
  connectMode: boolean;
  /** The node the pending connection originates from (cannot target itself). */
  connectSourceId: string | null;
  zoom: number;
  /** additive = Ctrl/Cmd/Shift held — toggles membership instead of replacing the selection. */
  onSelect: (id: string, additive: boolean) => void;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onMeasure: (id: string, height: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSetStart: (id: string) => void;
  onConnectTarget: (id: string) => void;
}

/** A draggable canvas card for a question or common-section node. */
const FlowNodeCard: React.FC<FlowNodeCardProps> = ({
  node,
  isStart,
  selected,
  connectMode,
  connectSourceId,
  zoom,
  onSelect,
  onMove,
  onMeasure,
  onDuplicate,
  onDelete,
  onSetStart,
  onConnectTarget,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
    additive: boolean;
  } | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => onMeasure(node.id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [node.id, onMeasure]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // never start a canvas pan from a card
    if (connectMode) return; // click handler resolves the connection
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: node.position.x,
      origY: node.position.y,
      moved: false,
      additive: e.ctrlKey || e.metaKey || e.shiftKey,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      // Dragging a card that is already part of the selection keeps the whole
      // selection (group move); dragging an unselected card selects just it.
      if (!selected) onSelect(node.id, false);
    }
    onMove(node.id, {
      x: Math.round((d.origX + dx) / GRID) * GRID,
      y: Math.round((d.origY + dy) / GRID) * GRID,
    });
  };

  const handlePointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) onSelect(node.id, d.additive);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!connectMode) return;
    e.stopPropagation();
    onConnectTarget(node.id);
  };

  const isSection = node.kind === 'section';
  const question = isQuestionNode(node) ? node : null;
  const info = isInfoNode(node) ? node : null;
  const matrix = isMatrixNode(node) ? node : null;
  const hasOptions =
    question !== null && (question.questionType === 'single' || question.questionType === 'multi');
  const endsHere =
    !node.next &&
    !(question !== null && question.questionType === 'single' && question.options.some(o => o.next));
  const connectTargetable = connectMode && node.id !== connectSourceId;

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
      className={cn(
        'group absolute select-none touch-none',
        connectMode
          ? connectTargetable
            ? 'cursor-crosshair'
            : 'cursor-not-allowed opacity-60'
          : 'cursor-grab active:cursor-grabbing',
      )}
      style={{ left: node.position.x, top: node.position.y, width: NODE_W }}
    >
      {/* Stacked-paper backdrop for sections */}
      {isSection && (
        <>
          <div className="absolute inset-x-3 -bottom-2.5 top-3 rounded-xl border border-border bg-surface-sunken/70" aria-hidden />
          <div className="absolute inset-x-1.5 -bottom-1.5 top-1.5 rounded-xl border border-border bg-surface" aria-hidden />
        </>
      )}

      <div
        className={cn(
          'relative rounded-xl border bg-surface shadow-(--shadow-card) transition-[box-shadow,border-color] duration-150',
          selected
            ? 'border-primary ring-2 ring-primary/40 shadow-(--shadow-card-hover)'
            : 'border-border hover:border-border-strong',
          connectTargetable && 'hover:border-primary hover:ring-2 hover:ring-primary/40',
        )}
      >
        {isStart && (
          <span className="absolute -top-2.5 left-3 rounded-full bg-primary px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-primary-fg shadow-sm">
            Start
          </span>
        )}

        <div className="px-3.5 pb-3 pt-3.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            {isSection && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-bold text-sage-700 dark:bg-sage-500/15 dark:text-sage-300">
                <Layers className="size-3" /> Section
              </span>
            )}
            {info && (
              <span className="inline-flex items-center gap-1 rounded-full bg-info-50 px-2 py-0.5 text-[10px] font-bold text-info-600 dark:bg-coral-500/15 dark:text-coral-300">
                <Info className="size-3" /> Info block
              </span>
            )}
            {matrix && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-500">
                <Table className="size-3" /> Matrix
              </span>
            )}
            {question &&
              (() => {
                const badge = TYPE_BADGES[question.questionType];
                const Icon = badge.icon;
                return (
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', badge.classes)}>
                    <Icon className="size-3" /> {badge.label}
                  </span>
                );
              })()}
          </div>

          <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink">
            {nodeTitle(node)}
          </div>

          {isSection && node.kind === 'section' && (
            <div className="mt-2 space-y-0.5">
              <div className="text-[11px] font-semibold text-ink-faint">
                {node.children.length} question{node.children.length === 1 ? '' : 's'} inside
              </div>
              {node.children.slice(0, 2).map(c => (
                <div key={c.id} className="truncate text-[11px] text-ink-faint">
                  · {nodeTitle(c)}
                </div>
              ))}
            </div>
          )}

          {question && hasOptions && (
            <div className="mt-2 flex items-center gap-1">
              {question.options.slice(0, 8).map(o => (
                <DotMini key={o.id} verdict={o.verdict} />
              ))}
              {question.options.length > 8 && (
                <span className="text-[10px] font-bold text-ink-faint">+{question.options.length - 8}</span>
              )}
              <span className="ml-1 text-[11px] text-ink-faint">
                {question.options.length} option{question.options.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
          {question && !hasOptions && (
            <div className="mt-2 text-[11px] text-ink-faint">
              {question.questionType === 'text'
                ? 'Free text answer'
                : question.questionType === 'number'
                  ? 'Numerical answer'
                  : 'Date answer'}
            </div>
          )}

          {info && (info.body.trim() || info.action.type !== 'none') && (
            <div className="mt-2 space-y-0.5">
              {info.body.trim() && (
                <div className="line-clamp-2 text-[11px] text-ink-faint">{truncate(info.body.trim(), 90)}</div>
              )}
              {info.action.type !== 'none' && (
                <div className="text-[11px] font-semibold text-ink-faint">▶ {info.action.type} attached</div>
              )}
            </div>
          )}

          {matrix && (
            <div className="mt-2 text-[11px] text-ink-faint">
              {matrix.rows.length} row{matrix.rows.length === 1 ? '' : 's'} ×{' '}
              {matrix.columns.length} column{matrix.columns.length === 1 ? '' : 's'}
            </div>
          )}

          {endsHere && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              <Flag className="size-3" /> Ends form
            </div>
          )}
        </div>
      </div>

      {/* Hover / selected actions */}
      {!connectMode && (
        <div
          className={cn(
            'absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-md transition-opacity duration-100',
            selected
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
          )}
        >
          {!isStart && (
            <button
              type="button"
              title="Make this the start"
              className={cardBtn}
              onClick={e => {
                e.stopPropagation();
                onSetStart(node.id);
              }}
            >
              <Flag className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Duplicate"
            className={cardBtn}
            onClick={e => {
              e.stopPropagation();
              onDuplicate(node.id);
            }}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            title="Delete"
            className={cn(cardBtn, 'hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10')}
            onClick={e => {
              e.stopPropagation();
              onDelete(node.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(FlowNodeCard);
