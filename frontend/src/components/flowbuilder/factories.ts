/**
 * Factory helpers that create fresh, contract-conformant flow-schema objects.
 * All ids come from `makeId` (lib/flowGraph) so they never collide.
 */

import { makeId } from '../../lib/flowGraph';
import { emptyAction } from '../../lib/flowTypes';
import type {
  FlowInfoNode,
  FlowMatrixNode,
  FlowMedia,
  FlowNode,
  FlowOption,
  FlowQuestionNode,
  FlowSectionChild,
  FlowSectionNode,
  MatrixColumn,
  MatrixRow,
} from '../../lib/flowTypes';

export const makeOption = (label = ''): FlowOption => ({
  id: makeId('o'),
  label,
  media: [],
  verdict: null,
  action: emptyAction(),
  next: null,
});

export const makeQuestionNode = (position: { x: number; y: number }): FlowQuestionNode => ({
  id: makeId('n'),
  kind: 'question',
  questionType: 'single',
  title: '',
  helpText: '',
  required: true,
  media: [],
  position,
  options: [makeOption(), makeOption()],
  next: null,
});

export const makeSectionChild = (): FlowSectionChild => ({
  id: makeId('q'),
  kind: 'question',
  questionType: 'single',
  title: '',
  helpText: '',
  required: true,
  media: [],
  options: [makeOption(), makeOption()],
});

export const makeSectionNode = (position: { x: number; y: number }): FlowSectionNode => ({
  id: makeId('s'),
  kind: 'section',
  title: '',
  position,
  children: [makeSectionChild()],
  next: null,
});

export const makeInfoNode = (position: { x: number; y: number }): FlowInfoNode => ({
  id: makeId('i'),
  kind: 'info',
  title: '',
  body: '',
  media: [],
  action: emptyAction(),
  position,
  next: null,
});

export const makeMatrixColumn = (label = '', type: MatrixColumn['type'] = 'dropdown'): MatrixColumn => ({
  id: makeId('c'),
  label,
  type,
  required: false,
  options: type === 'dropdown' ? [] : null,
  numeric: type === 'number' ? { decimals: 1 } : null,
});

export const makeMatrixRow = (label = ''): MatrixRow => ({ id: makeId('r'), label });

export const makeMatrixNode = (position: { x: number; y: number }): FlowMatrixNode => ({
  id: makeId('m'),
  kind: 'matrix',
  title: '',
  helpText: '',
  required: true,
  rows: [makeMatrixRow()],
  columns: [makeMatrixColumn('', 'dropdown')],
  position,
  next: null,
});

const cloneMedia = (media: FlowMedia[]): FlowMedia[] => media.map(m => ({ ...m }));

/** Deep copy with a fresh id; branch targets are cleared on the copy. */
const cloneOption = (o: FlowOption): FlowOption => ({
  ...o,
  id: makeId('o'),
  media: cloneMedia(o.media),
  action: { ...o.action },
  next: null,
});

const cloneChild = (c: FlowSectionChild): FlowSectionChild => ({
  ...c,
  id: makeId('q'),
  media: cloneMedia(c.media ?? []),
  options: c.options.map(cloneOption),
});

/**
 * Deep-copies a node with fresh ids, offset by +40/+40. Option branch targets
 * are cleared (they belonged to the original's place in the flow); the default
 * `next` is kept since it still points at a valid node.
 */
export function duplicateNode(node: FlowNode): FlowNode {
  const position = { x: node.position.x + 40, y: node.position.y + 40 };
  if (node.kind === 'section') {
    return { ...node, id: makeId('s'), position, children: node.children.map(cloneChild) };
  }
  if (node.kind === 'info') {
    return { ...node, id: makeId('i'), position, media: cloneMedia(node.media), action: { ...node.action } };
  }
  if (node.kind === 'matrix') {
    return {
      ...node,
      id: makeId('m'),
      position,
      rows: node.rows.map(r => ({ ...r, id: makeId('r') })),
      columns: node.columns.map(c => ({
        ...c,
        id: makeId('c'),
        options: c.options ? c.options.map(o => ({ ...o })) : null,
        numeric: c.numeric ? { ...c.numeric } : null,
      })),
    };
  }
  return {
    ...node,
    id: makeId('n'),
    position,
    media: cloneMedia(node.media ?? []),
    options: node.options.map(cloneOption),
    numeric: node.numeric ? { ...node.numeric } : node.numeric,
  };
}

/**
 * Deep-copies a GROUP of nodes for clipboard paste. All ids are refreshed;
 * `next` / option-branch targets that point INSIDE the group are remapped to
 * the corresponding clones (the copied sub-flow stays wired together), while
 * targets pointing at nodes outside the group are kept as-is.
 */
export function cloneNodesForPaste(
  nodes: FlowNode[],
  offset: { x: number; y: number },
): FlowNode[] {
  const prefixFor = (kind: FlowNode['kind']): string =>
    kind === 'section' ? 's' : kind === 'info' ? 'i' : kind === 'matrix' ? 'm' : 'n';
  const idMap = new Map(nodes.map(n => [n.id, makeId(prefixFor(n.kind))]));
  const remap = (target: string | null): string | null =>
    target && idMap.has(target) ? idMap.get(target)! : target;

  return nodes.map(n => {
    const id = idMap.get(n.id)!;
    const position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
    if (n.kind === 'section') {
      return { ...n, id, position, next: remap(n.next), children: n.children.map(cloneChild) };
    }
    if (n.kind === 'info') {
      return { ...n, id, position, next: remap(n.next), media: cloneMedia(n.media), action: { ...n.action } };
    }
    if (n.kind === 'matrix') {
      return {
        ...n,
        id,
        position,
        next: remap(n.next),
        rows: n.rows.map(r => ({ ...r, id: makeId('r') })),
        columns: n.columns.map(c => ({
          ...c,
          id: makeId('c'),
          options: c.options ? c.options.map(o => ({ ...o })) : null,
          numeric: c.numeric ? { ...c.numeric } : null,
        })),
      };
    }
    return {
      ...n,
      id,
      position,
      next: remap(n.next),
      media: cloneMedia(n.media ?? []),
      numeric: n.numeric ? { ...n.numeric } : n.numeric,
      options: n.options.map(o => ({
        ...o,
        id: makeId('o'),
        media: cloneMedia(o.media),
        action: { ...o.action },
        next: remap(o.next),
      })),
    };
  });
}
