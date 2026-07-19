/**
 * Factory helpers that create fresh, contract-conformant flow-schema objects.
 * All ids come from `makeId` (lib/flowGraph) so they never collide.
 */

import { makeId } from '../../lib/flowGraph';
import { emptyAction } from '../../lib/flowTypes';
import type {
  FlowMedia,
  FlowNode,
  FlowOption,
  FlowQuestionNode,
  FlowSectionChild,
  FlowSectionNode,
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
  return {
    ...node,
    id: makeId('n'),
    position,
    media: cloneMedia(node.media ?? []),
    options: node.options.map(cloneOption),
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
  const idMap = new Map(nodes.map(n => [n.id, makeId(n.kind === 'section' ? 's' : 'n')]));
  const remap = (target: string | null): string | null =>
    target && idMap.has(target) ? idMap.get(target)! : target;

  return nodes.map(n => {
    const id = idMap.get(n.id)!;
    const position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
    if (n.kind === 'section') {
      return { ...n, id, position, next: remap(n.next), children: n.children.map(cloneChild) };
    }
    return {
      ...n,
      id,
      position,
      next: remap(n.next),
      media: cloneMedia(n.media ?? []),
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
