import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minus, MousePointerClick, Plus, Workflow } from 'lucide-react';
import type { FlowSchema } from '../../lib/flowTypes';
import { Button, EmptyState } from '../ui';
import { cn } from '../../utils/cn';
import FlowEdges from './FlowEdges';
import FlowNodeCard from './FlowNodeCard';
import { DEFAULT_NODE_H, NODE_W, ZOOM_MAX, ZOOM_MIN } from './constants';
import type { ConnectRequest } from './constants';

export interface FlowCanvasProps {
  schema: FlowSchema;
  selectedId: string | null;
  connect: ConnectRequest | null;
  onSelect: (id: string | null) => void;
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

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

const zoomBtn =
  'flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink cursor-pointer';

/**
 * The pannable/zoomable node canvas. Built on raw pointer events: drag empty
 * space to pan, wheel to zoom (cursor-anchored), drag cards to move them.
 */
const FlowCanvas: React.FC<FlowCanvasProps> = ({
  schema,
  selectedId,
  connect,
  onSelect,
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
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const nodeCount = Object.keys(schema.nodes).length;

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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Buttons/inputs inside the viewport (empty state, zoom controls) keep
    // their native click behaviour — pointer capture would swallow it.
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPanning(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    p.moved = true;
    setView(v => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
  };

  const handlePointerUp = () => {
    const p = panRef.current;
    panRef.current = null;
    setPanning(false);
    if (p && !p.moved) {
      // A plain click on empty canvas: cancel connect mode or clear selection.
      if (connect) onCancelConnect();
      else onSelect(null);
    }
  };

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative h-full min-w-0 flex-1 touch-none overflow-hidden bg-background',
        connect ? 'cursor-crosshair' : panning ? 'cursor-grabbing' : 'cursor-grab',
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
        <FlowEdges schema={schema} heights={heights} selectedId={selectedId} />
        {Object.values(schema.nodes).map(node => (
          <FlowNodeCard
            key={node.id}
            node={node}
            isStart={schema.startNodeId === node.id}
            selected={selectedId === node.id}
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
