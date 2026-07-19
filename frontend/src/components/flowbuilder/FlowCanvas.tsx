import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hand, Maximize, Minus, MousePointer2, MousePointerClick, Plus, Workflow } from 'lucide-react';
import type { FlowSchema } from '../../lib/flowTypes';
import { Button, EmptyState } from '../ui';
import { cn } from '../../utils/cn';
import FlowEdges from './FlowEdges';
import FlowNodeCard from './FlowNodeCard';
import { DEFAULT_NODE_H, NODE_W, ZOOM_MAX, ZOOM_MIN } from './constants';
import type { ConnectRequest } from './constants';

export interface FlowCanvasProps {
  schema: FlowSchema;
  selectedIds: string[];
  connect: ConnectRequest | null;
  /** Card tap: additive = Ctrl/Cmd/Shift held (toggle membership). */
  onSelect: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
  /** Marquee result. additive = Shift held while dragging the box. */
  onMarqueeSelect: (ids: string[], additive: boolean) => void;
  onMoveNode: (id: string, pos: { x: number; y: number }) => void;
  onConnectTarget: (id: string) => void;
  onCancelConnect: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSetStart: (id: string) => void;
  onAddFirst: () => void;
}

interface View {
  x: number;
  y: number;
  zoom: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const normalizeRect = (x1: number, y1: number, x2: number, y2: number): Rect => ({
  x: Math.min(x1, x2),
  y: Math.min(y1, y2),
  w: Math.abs(x2 - x1),
  h: Math.abs(y2 - y1),
});

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

const zoomBtn =
  'flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer';

/**
 * The pannable/zoomable node canvas. Built on raw pointer events:
 *  - left-drag on empty space draws a marquee that multi-selects cards,
 *  - Space+drag or middle-mouse drag pans, wheel zooms (cursor-anchored),
 *  - dragging a card moves it (and the rest of the selection with it).
 */
const FlowCanvas: React.FC<FlowCanvasProps> = ({
  schema,
  selectedIds,
  connect,
  onSelect,
  onClearSelection,
  onMarqueeSelect,
  onMoveNode,
  onConnectTarget,
  onCancelConnect,
  onDuplicate,
  onDelete,
  onSetStart,
  onAddFirst,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 80, y: 48, zoom: 1 });
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  /** What a plain left-drag on empty canvas does. Space/middle always pans. */
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const marqueeRef = useRef<{ sx: number; sy: number; additive: boolean; moved: boolean } | null>(null);
  const nodeCount = Object.keys(schema.nodes).length;

  // Space toggles pan mode (ignored while typing in the editor panel).
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.code === 'Space') setSpaceHeld(true);
      // Tool shortcuts, design-tool style: V = select, H = hand/pan.
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key.toLowerCase() === 'v') setTool('select');
        else if (e.key.toLowerCase() === 'h') setTool('pan');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onMeasure = useCallback((id: string, h: number) => {
    setHeights(prev => (prev[id] === h ? prev : { ...prev, [id]: h }));
  }, []);

  // Wheel zoom must be a native non-passive listener (React's is passive).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView(v => {
        const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0016));
        if (zoom === v.zoom) return v;
        const k = zoom / v.zoom;
        return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 400;
    const cy = rect ? rect.height / 2 : 300;
    setView(v => {
      const zoom = clampZoom(v.zoom * factor);
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  const fit = useCallback(() => {
    const el = viewportRef.current;
    const nodes = Object.values(schema.nodes);
    if (!el || nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + NODE_W);
      maxY = Math.max(maxY, n.position.y + (heights[n.id] ?? DEFAULT_NODE_H));
    }
    const rect = el.getBoundingClientRect();
    const pad = 64;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const zoom = clampZoom(Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h, 1));
    setView({
      zoom,
      x: (rect.width - w * zoom) / 2 - minX * zoom,
      y: (rect.height - h * zoom) / 2 - minY * zoom,
    });
  }, [schema.nodes, heights]);

  // Fit once when content first appears.
  const didFitRef = useRef(false);
  useEffect(() => {
    if (!didFitRef.current && nodeCount > 0) {
      didFitRef.current = true;
      fit();
    }
  }, [nodeCount, fit]);

  /** Viewport-relative pointer position. */
  const localPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // Buttons/inputs inside the viewport (empty state, zoom controls) keep
    // their native click behaviour — pointer capture would swallow it.
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;

    const wantsPan = e.button === 1 || (e.button === 0 && (spaceHeld || tool === 'pan' || !!connect));
    if (wantsPan) {
      e.preventDefault(); // middle-click autoscroll
      panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    // Left-drag on empty canvas: marquee selection.
    const p = localPoint(e);
    marqueeRef.current = { sx: p.x, sy: p.y, additive: e.shiftKey, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (p) {
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      if (!p.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      p.moved = true;
      setView(v => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
      return;
    }
    const m = marqueeRef.current;
    if (m) {
      const pt = localPoint(e);
      if (!m.moved && Math.abs(pt.x - m.sx) + Math.abs(pt.y - m.sy) < 3) return;
      m.moved = true;
      setMarquee(normalizeRect(m.sx, m.sy, pt.x, pt.y));
    }
  };

  const handlePointerUp = () => {
    const p = panRef.current;
    if (p) {
      panRef.current = null;
      setPanning(false);
      if (!p.moved) {
        // A plain click (in pan mode) on empty canvas: cancel connect mode.
        if (connect) onCancelConnect();
        else onClearSelection();
      }
      return;
    }
    const m = marqueeRef.current;
    marqueeRef.current = null;
    if (!m) return;
    if (!m.moved) {
      setMarquee(null);
      onClearSelection();
      return;
    }
    // Convert the screen-space box to world space and pick intersecting cards.
    const box = marquee;
    setMarquee(null);
    if (!box) return;
    const wx1 = (box.x - view.x) / view.zoom;
    const wy1 = (box.y - view.y) / view.zoom;
    const wx2 = (box.x + box.w - view.x) / view.zoom;
    const wy2 = (box.y + box.h - view.y) / view.zoom;
    const hit: string[] = [];
    for (const node of Object.values(schema.nodes)) {
      const nx1 = node.position.x;
      const ny1 = node.position.y;
      const nx2 = nx1 + NODE_W;
      const ny2 = ny1 + (heights[node.id] ?? DEFAULT_NODE_H);
      if (nx1 < wx2 && nx2 > wx1 && ny1 < wy2 && ny2 > wy1) hit.push(node.id);
    }
    onMarqueeSelect(hit, m.additive);
  };

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative h-full min-w-0 flex-1 touch-none overflow-hidden bg-background',
        connect
          ? 'cursor-crosshair'
          : panning
            ? 'cursor-grabbing'
            : spaceHeld || tool === 'pan'
              ? 'cursor-grab'
              : 'cursor-default',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        backgroundImage: 'radial-gradient(var(--color-border) 1px, transparent 1px)',
        backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      {/* World layer: edges behind, node cards on top */}
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}
      >
        <FlowEdges
          schema={schema}
          heights={heights}
          selectedId={selectedIds.length === 1 ? selectedIds[0] : null}
        />
        {Object.values(schema.nodes).map(node => (
          <FlowNodeCard
            key={node.id}
            node={node}
            isStart={schema.startNodeId === node.id}
            selected={selectedIds.includes(node.id)}
            connectMode={!!connect}
            connectSourceId={connect?.nodeId ?? null}
            zoom={view.zoom}
            onSelect={onSelect}
            onMove={onMoveNode}
            onMeasure={onMeasure}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onSetStart={onSetStart}
            onConnectTarget={onConnectTarget}
          />
        ))}
      </div>

      {/* Empty state */}
      {nodeCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <EmptyState
            className="max-w-md bg-surface"
            icon={<Workflow />}
            title="Design your first question"
            description="This canvas holds the decision tree learners walk through, one question at a time. Add a question, then connect its answers to follow-up steps."
            action={
              <Button onClick={onAddFirst} iconLeft={<Plus className="size-4" />}>
                Add first question
              </Button>
            }
          />
        </div>
      )}

      {/* Marquee selection box */}
      {marquee && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 rounded-sm border border-primary bg-primary/10"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}

      {/* Interaction hints */}
      {nodeCount > 0 && !connect && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 hidden rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-[11px] text-ink-faint shadow-sm backdrop-blur-sm lg:block">
          {tool === 'select' ? 'Drag: select' : 'Drag: pan'} · V/H: switch tool · Space / middle-drag: pan ·
          Ctrl+C/V: copy &amp; paste · Del: delete · Ctrl+Z: undo
        </div>
      )}

      {/* Tool switcher: what a plain left-drag does */}
      <div className="absolute bottom-4 right-40 z-20 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-(--shadow-card)">
        <button
          type="button"
          title="Select tool — drag a box to multi-select (V)"
          onClick={() => setTool('select')}
          className={cn(
            'flex size-7 items-center justify-center rounded-md cursor-pointer',
            tool === 'select'
              ? 'bg-primary text-primary-fg'
              : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
          )}
        >
          <MousePointer2 className="size-3.5" />
        </button>
        <button
          type="button"
          title="Pan tool — drag to move around the canvas (H)"
          onClick={() => setTool('pan')}
          className={cn(
            'flex size-7 items-center justify-center rounded-md cursor-pointer',
            tool === 'pan'
              ? 'bg-primary text-primary-fg'
              : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
          )}
        >
          <Hand className="size-3.5" />
        </button>
      </div>

      {/* Connect-mode hint */}
      {connect && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 animate-fade-in">
          <span className="flex items-center gap-2 whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-lg">
            <MousePointerClick className="size-4" /> Click a card to connect — Esc to cancel
          </span>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-(--shadow-card)">
        <button type="button" title="Zoom out" onClick={() => zoomBy(1 / 1.2)} className={zoomBtn}>
          <Minus className="size-3.5" />
        </button>
        <span className="w-11 text-center text-[11px] font-bold tabular-nums text-ink-muted">
          {Math.round(view.zoom * 100)}%
        </span>
        <button type="button" title="Zoom in" onClick={() => zoomBy(1.2)} className={zoomBtn}>
          <Plus className="size-3.5" />
        </button>
        <button type="button" title="Fit to view" onClick={fit} className={zoomBtn}>
          <Maximize className="size-3.5" />
        </button>
      </div>
    </div>
  );
};

export default FlowCanvas;
