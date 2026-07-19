import React from 'react';
import { isQuestionNode } from '../../lib/flowTypes';
import type { FlowSchema } from '../../lib/flowTypes';
import { DEFAULT_NODE_H, EDGE_COLORS, NODE_W, truncate, verdictEdgeColor } from './constants';

interface EdgeDatum {
  key: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  color: string;
  label?: string;
  emphasized: boolean;
}

export interface FlowEdgesProps {
  schema: FlowSchema;
  /** Measured card heights, keyed by node id (world units). */
  heights: Record<string, number>;
  selectedId: string | null;
}

/**
 * SVG bezier edge layer, rendered behind the node cards inside the world
 * transform. Default nexts are slate; option branches are colored by verdict
 * and carry a small label chip.
 */
const FlowEdges: React.FC<FlowEdgesProps> = ({ schema, heights, selectedId }) => {
  const edges: EdgeDatum[] = [];

  for (const node of Object.values(schema.nodes)) {
    const h = heights[node.id] ?? DEFAULT_NODE_H;
    const outs: { to: string; color: string; label?: string }[] = [];

    if (node.next && schema.nodes[node.next]) {
      outs.push({ to: node.next, color: EDGE_COLORS.default });
    }
    if (isQuestionNode(node) && node.questionType === 'single') {
      for (const o of node.options) {
        if (o.next && schema.nodes[o.next]) {
          outs.push({
            to: o.next,
            color: verdictEdgeColor(o.verdict),
            label: truncate(o.label.trim() || 'Option', 18),
          });
        }
      }
    }

    outs.forEach((out, i) => {
      const target = schema.nodes[out.to];
      if (!target) return;
      const th = heights[out.to] ?? DEFAULT_NODE_H;
      edges.push({
        key: `${node.id}:${out.to}:${i}`,
        sx: node.position.x + NODE_W,
        sy: node.position.y + (h * (i + 1)) / (outs.length + 1),
        tx: target.position.x,
        ty: target.position.y + Math.min(36, th / 2),
        color: out.color,
        label: out.label,
        emphasized: selectedId === node.id || selectedId === out.to,
      });
    });
  }

  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
      {edges.map(e => {
        const dx = Math.max(48, Math.abs(e.tx - e.sx) / 2);
        const c1x = e.sx + dx;
        const c2x = e.tx - dx;
        const d = `M ${e.sx} ${e.sy} C ${c1x} ${e.sy}, ${c2x} ${e.ty}, ${e.tx} ${e.ty}`;
        // Cubic bezier midpoint (t = 0.5): (P0 + 3·P1 + 3·P2 + P3) / 8
        const midX = (e.sx + 3 * c1x + 3 * c2x + e.tx) / 8;
        const midY = (e.sy + e.ty) / 2;
        const labelW = e.label ? e.label.length * 6.4 + 14 : 0;

        return (
          <g key={e.key} opacity={selectedId && !e.emphasized ? 0.35 : 1}>
            <path
              d={d}
              fill="none"
              stroke={e.color}
              strokeWidth={e.emphasized ? 2.5 : 2}
              strokeLinecap="round"
            />
            <circle cx={e.sx} cy={e.sy} r={3} fill={e.color} />
            <circle cx={e.tx} cy={e.ty} r={3.5} fill={e.color} />
            {e.label && (
              <g>
                <rect
                  x={midX - labelW / 2}
                  y={midY - 9}
                  width={labelW}
                  height={18}
                  rx={9}
                  fill="var(--color-surface)"
                  stroke={e.color}
                  strokeOpacity={0.55}
                />
                <text
                  x={midX}
                  y={midY + 3.5}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--color-ink-muted)"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {e.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default React.memo(FlowEdges);
