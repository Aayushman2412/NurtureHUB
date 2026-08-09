/**
 * Online-first mutation helpers with offline fallback.
 *
 * Each helper tries the normal API call; when the failure is a NETWORK error
 * (offline, backend unreachable) the mutation is captured in the IndexedDB
 * queue instead and the caller gets `{ queued: true, tempId }` to show the
 * "saved on this device" UX. Server-side rejections (4xx/5xx with a response)
 * are re-thrown untouched — validation feedback must reach the user.
 *
 * Responses COALESCE: a visit that was queued offline keeps ONE queue item —
 * later draft-saves/submits in the same visit replace its payload (same
 * client_ref) instead of enqueueing another creation, so sync can never
 * produce duplicate rows for one visit. Payloads still referencing offline
 * markers (`tmp-` subjects, `offline-media:` photos) are never sent online —
 * the server would store the marker string verbatim.
 */
import axios from 'axios';
import { createResponse, updateResponse, type ResponsePayload } from '../api/forms';
import type { FormKey, FormResponseDetail } from '../lib/flowTypes';
import { createMother } from '../api/mothers';
import { createChild } from '../api/children';
import type { MotherPayload, Mother } from '../api/mothers';
import type { ChildPayload, Child } from '../api/children';
import {
  collectUnresolvedMarkers, enqueue, findByTempId, isTempId, listOwnQueue,
  newIdWithPrefix, remapDeep, resolveId, updateItem,
} from './queue';
import { syncQueue } from './sync';

export function isNetworkError(err: unknown): boolean {
  const e = err as { response?: unknown; request?: unknown; code?: string };
  // A cancelled request is not connectivity loss — never queue for it.
  if (axios.isCancel(err) || e.code === 'ERR_CANCELED') return false;
  // The server answered (even while the browser claims offline): real response.
  if (e.response !== undefined) return false;
  if (!navigator.onLine) return true;
  return e.request !== undefined || e.code === 'ERR_NETWORK';
}

export type QueuedResult = { queued: true; tempId?: string };

export function isQueuedResult(value: unknown): value is QueuedResult {
  return typeof value === 'object' && value !== null && (value as QueuedResult).queued === true;
}

type BarePayload = Omit<ResponsePayload, 'child_id' | 'mother_id'>;

export interface PersistResponseArgs {
  formKey: FormKey;
  /** Server row id, a queued creation's `tmp-` id, or null for a new visit. */
  responseId: number | string | null;
  /** Exactly one of mother_id / child_id (may be a `tmp-` id). */
  subject: { mother_id?: number | string; child_id?: number | string };
  payload: BarePayload;
  label: string;
}

/**
 * One entry point for the runners: create, coalesce-into-queued, or update —
 * whichever the visit's current identity requires.
 */
export async function persistResponseResilient(
  args: PersistResponseArgs,
): Promise<FormResponseDetail | QueuedResult> {
  const { formKey, subject, payload, label } = args;
  let responseId = args.responseId;

  // A queued creation may have synced in the background — switch to its row.
  if (isTempId(responseId)) {
    const queued = await findByTempId(responseId);
    if (queued) return coalesceQueuedResponse(queued, subject, payload, label);
    const real = await resolveId(responseId);
    responseId = typeof real === 'number' ? real : real != null ? Number(real) : null;
    if (responseId != null && Number.isNaN(responseId)) responseId = null;
  }

  if (typeof responseId === 'number') {
    return updateResponseResilient(responseId, payload, label);
  }
  return submitResponseResilient(formKey, { ...subject, ...payload } as ResponsePayload, label);
}

/** Replace a queued creation's content in place (same item, same client_ref). */
async function coalesceQueuedResponse(
  queued: NonNullable<Awaited<ReturnType<typeof findByTempId>>>,
  subject: { mother_id?: number | string; child_id?: number | string },
  payload: BarePayload,
  label: string,
): Promise<QueuedResult> {
  const clientRef = (queued.payload as { client_ref?: string }).client_ref;
  queued.payload = { ...subject, ...payload, client_ref: clientRef } as Record<string, unknown>;
  queued.label = label;
  queued.dependsOn = responseDeps(queued.payload);
  // New content may fix whatever the server rejected — make it eligible again.
  queued.status = 'pending';
  queued.error = undefined;
  queued.blockedBy = undefined;
  await updateItem(queued);
  void syncQueue();
  return { queued: true, tempId: queued.tempId };
}

/** Everything this response payload must wait for: subjects + queued photos. */
function responseDeps(payload: unknown): string[] {
  return collectUnresolvedMarkers(payload);
}

export async function submitResponseResilient(
  formKey: FormKey,
  payload: ResponsePayload,
  subjectLabel: string,
): Promise<FormResponseDetail | QueuedResult> {
  const clientRef = crypto.randomUUID();
  // Resolve markers that already synced in the background (e.g. an uploaded
  // photo) so the online path sends real values, not marker strings.
  const resolved = await remapDeep(payload);
  const body = { ...resolved, client_ref: clientRef } as ResponsePayload & { client_ref: string };
  const deps = responseDeps(body);
  // Unresolved markers (offline subject, un-uploaded photo) make an online
  // submit unsafe — the marker string would be stored server-side verbatim.
  if (deps.length === 0) {
    try {
      return await createResponse(formKey, body);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  const tempId = newIdWithPrefix();
  await enqueue({
    kind: 'response_create',
    label: subjectLabel,
    payload: body as unknown as Record<string, unknown>,
    route: { formKey },
    dependsOn: deps,
    tempId,
  });
  void syncQueue();
  return { queued: true, tempId };
}

export async function updateResponseResilient(
  responseId: number,
  payload: BarePayload,
  subjectLabel: string,
): Promise<FormResponseDetail | QueuedResult> {
  const resolved = await remapDeep(payload);
  const deps = responseDeps(resolved);
  if (deps.length === 0) {
    try {
      return await updateResponse(responseId, resolved);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  // Coalesce with an already-queued update of the same row — two offline
  // edits of one visit must stay one queue item, not fight each other.
  const existing = (await listOwnQueue()).find(
    i => i.kind === 'response_update' && i.route.responseId === responseId,
  );
  if (existing) {
    existing.payload = resolved as unknown as Record<string, unknown>;
    existing.label = subjectLabel;
    existing.dependsOn = deps;
    existing.status = 'pending';
    existing.error = undefined;
    existing.blockedBy = undefined;
    await updateItem(existing);
  } else {
    await enqueue({
      kind: 'response_update',
      label: subjectLabel,
      payload: resolved as unknown as Record<string, unknown>,
      route: { responseId },
      dependsOn: deps,
    });
  }
  void syncQueue();
  return { queued: true };
}

export async function createMotherResilient(
  payload: MotherPayload,
  label: string,
): Promise<Mother | QueuedResult> {
  const clientRef = crypto.randomUUID();
  const body = { ...payload, client_ref: clientRef } as MotherPayload & { client_ref: string };
  try {
    return await createMother(body);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
  }
  const tempId = newIdWithPrefix();
  await enqueue({
    kind: 'mother',
    label,
    payload: body as unknown as Record<string, unknown>,
    tempId,
  });
  void syncQueue();
  return { queued: true, tempId };
}

export async function createChildResilient(
  motherId: number | string,
  payload: ChildPayload,
  label: string,
): Promise<Child | QueuedResult> {
  const clientRef = crypto.randomUUID();
  const body = { ...payload, client_ref: clientRef } as ChildPayload & { client_ref: string };
  if (!isTempId(motherId)) {
    try {
      return await createChild(motherId as number, body);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  const tempId = newIdWithPrefix();
  await enqueue({
    kind: 'child',
    label,
    payload: body as unknown as Record<string, unknown>,
    route: { motherId },
    dependsOn: isTempId(motherId) ? [motherId as string] : undefined,
    tempId,
  });
  void syncQueue();
  return { queued: true, tempId };
}

/** A visit already queued offline for this subject+form (runner re-adoption). */
export async function findQueuedResponseCreate(
  formKey: string,
  subject: { mother_id?: number | string; child_id?: number | string },
): Promise<{ tempId: string; payload: Record<string, unknown> } | null> {
  const items = await listOwnQueue();
  const match = items.find(i => {
    if (i.kind !== 'response_create' || i.route.formKey !== formKey || !i.tempId) return false;
    const p = i.payload as { mother_id?: unknown; child_id?: unknown };
    if (subject.child_id !== undefined) return p.child_id === subject.child_id;
    return p.mother_id === subject.mother_id;
  });
  return match?.tempId ? { tempId: match.tempId, payload: match.payload } : null;
}

/** A queued offline edit of an existing server row (runner re-adoption). */
export async function findQueuedResponseUpdate(
  responseId: number,
): Promise<Record<string, unknown> | null> {
  const items = await listOwnQueue();
  const match = items.find(i => i.kind === 'response_update' && i.route.responseId === responseId);
  return match ? match.payload : null;
}
