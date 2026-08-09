/**
 * Sync engine: drains the offline queue when connectivity returns.
 *
 * Replay rules:
 *  - Dependency order via multiple passes: media -> mothers -> children ->
 *    responses. An item whose `dependsOn` temp-ids have no server id yet is
 *    skipped this pass and picked up on the next one; passes repeat until a
 *    full pass makes no progress.
 *  - Temp-id remapping: queued payloads/routes may reference temp ids (child
 *    under an offline-registered mother, `offline-media:` answer values) —
 *    they are rewritten from the idmap just before sending. An item is never
 *    sent while any marker is still unresolved.
 *  - Ownership: only the current user's items are replayed. Another account's
 *    records (captured before a logout on a shared device) stay queued until
 *    that user logs back in — they must not sync under the wrong token.
 *  - Failure propagation: when a parent (mother/child/photo) fails with a
 *    4xx, its dependents are marked failed too ("waiting on ...") so they are
 *    visible and actionable instead of silently pending forever.
 *  - Idempotency: every creation carries a client_ref, so a replay whose
 *    response was lost cannot create duplicates server-side.
 *  - Auth: uses a bare axios instance WITHOUT the app's 401 interceptor — a
 *    mid-sync 401 must not hard-redirect and wipe the session while items
 *    remain queued. An expired token pauses sync until the next login.
 *  - Cross-tab: a Web Lock guarantees only one tab drains the shared queue.
 */
import axios from 'axios';
import { API_BASE_URL } from '../api/config';
import {
  depsOf, findByTempId, getMedia, listOwnQueue, mapId, remapDeep, remapValue,
  removeItem, resolveId, updateItem,
} from './queue';
import type { QueueItem } from './db';

export const SYNC_DONE_EVENT = 'nh-sync-done';
export const SYNC_AUTH_EVENT = 'nh-sync-auth-required';

/** Sentinel error codes translated by the pending-sync UI. */
export const ERR_MEDIA_LOST = 'NH_MEDIA_BLOB_LOST';

const bare = axios.create({ baseURL: API_BASE_URL });

let syncing = false;

function tokenIsUsable(): boolean {
  const token = localStorage.getItem('nh_token');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 30_000) return false;
  } catch {
    // Not a JWT we can decode — let the server decide.
  }
  return true;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('nh_token') ?? ''}` };
}

/** True when the item still references a temp id with no server id yet. */
async function stillBlocked(item: QueueItem): Promise<boolean> {
  for (const dep of depsOf(item)) {
    if ((await resolveId(dep)) === undefined) return true;
  }
  return false;
}

/**
 * When a dependency's parent item has FAILED, surface that on the dependent:
 * it becomes failed too, labelled with the parent it is waiting on. Returns
 * true when the item is currently blocked by a failed parent.
 */
async function propagateParentFailure(item: QueueItem): Promise<boolean> {
  for (const dep of depsOf(item)) {
    if ((await resolveId(dep)) !== undefined) continue;
    const parent = await findByTempId(dep);
    if (parent?.status === 'failed') {
      if (item.status !== 'failed' || item.blockedBy !== parent.label) {
        item.status = 'failed';
        item.blockedBy = parent.label;
        await updateItem(item);
      }
      return true;
    }
  }
  return false;
}

async function sendItem(item: QueueItem): Promise<void> {
  const headers = authHeaders();
  switch (item.kind) {
    case 'media': {
      const media = item.tempId ? await getMedia(item.tempId) : undefined;
      // Blob evicted/lost: the photo cannot be recovered. Fail loudly so the
      // learner sees it (and dependents sync without the photo only after an
      // explicit discard) instead of silently pretending success.
      if (!media) throw new Error(ERR_MEDIA_LOST);
      const form = new FormData();
      form.append('file', new File([media.blob], media.name, { type: media.type }));
      const res = await bare.post('/api/forms/uploads', form, { headers });
      await mapId(item.tempId!, res.data.url as string, 'media');
      return;
    }
    case 'mother': {
      const payload = await remapDeep(item.payload);
      const res = await bare.post('/api/mothers', payload, { headers });
      if (item.tempId) await mapId(item.tempId, res.data.id as number, 'mother');
      return;
    }
    case 'child': {
      const payload = await remapDeep(item.payload);
      const motherId = await remapValue(item.route.motherId);
      const res = await bare.post(`/api/mothers/${motherId}/children`, payload, { headers });
      if (item.tempId) await mapId(item.tempId, res.data.id as number, 'child');
      return;
    }
    case 'response_create': {
      const payload = await remapDeep(item.payload);
      const res = await bare.post(`/api/forms/${item.route.formKey}/responses`, payload, { headers });
      // A runner still open on this visit switches to updating the real row.
      if (item.tempId) await mapId(item.tempId, res.data.id as number, 'response_create');
      return;
    }
    case 'response_update': {
      const payload = await remapDeep(item.payload);
      const responseId = await remapValue(item.route.responseId);
      await bare.put(`/api/forms/responses/${responseId}`, payload, { headers });
      return;
    }
  }
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
}

async function drainQueue(): Promise<SyncResult> {
  if (!navigator.onLine) return { synced: 0, failed: 0, remaining: (await listOwnQueue()).length };
  if (!tokenIsUsable()) {
    if ((await listOwnQueue()).length > 0) window.dispatchEvent(new CustomEvent(SYNC_AUTH_EVENT));
    return { synced: 0, failed: 0, remaining: (await listOwnQueue()).length };
  }

  let synced = 0;
  let failed = 0;
  try {
    // Repeat passes until nothing more can move (resolves dependency chains).
    for (let pass = 0; pass < 6; pass++) {
      let progressed = false;
      const items = await listOwnQueue();
      for (const item of items) {
        if (item.status === 'failed') continue; // manual retry only
        if (await propagateParentFailure(item)) continue;
        if (await stillBlocked(item)) continue;
        try {
          await sendItem(item);
          await removeItem(item.id);
          synced += 1;
          progressed = true;
        } catch (err: unknown) {
          if (err instanceof Error && err.message === ERR_MEDIA_LOST) {
            item.status = 'failed';
            item.attempts += 1;
            item.error = ERR_MEDIA_LOST;
            await updateItem(item);
            failed += 1;
            continue;
          }
          const response = (err as { response?: { status?: number; data?: { detail?: unknown } } }).response;
          if (response && response.status && response.status >= 400 && response.status < 500) {
            if (response.status === 401) {
              // Token rejected server-side: pause the whole sync quietly.
              window.dispatchEvent(new CustomEvent(SYNC_AUTH_EVENT));
              return { synced, failed, remaining: (await listOwnQueue()).length };
            }
            item.status = 'failed';
            item.attempts += 1;
            item.error = typeof response.data?.detail === 'string'
              ? response.data.detail
              : `HTTP ${response.status}`;
            await updateItem(item);
            failed += 1;
          } else {
            // Network/5xx: stop this run; a later trigger retries everything.
            item.attempts += 1;
            await updateItem(item);
            return { synced, failed, remaining: (await listOwnQueue()).length };
          }
        }
      }
      if (!progressed) break;
    }
  } finally {
    window.dispatchEvent(new CustomEvent(SYNC_DONE_EVENT, { detail: { synced, failed } }));
  }
  return { synced, failed, remaining: (await listOwnQueue()).length };
}

export async function syncQueue(): Promise<SyncResult> {
  if (syncing) return { synced: 0, failed: 0, remaining: 0 };
  syncing = true;
  try {
    // Web Lock: two tabs draining the same IndexedDB queue would race into
    // duplicate media uploads. Absent lock support, the per-tab flag stands.
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks?.request) {
      let result: SyncResult = { synced: 0, failed: 0, remaining: 0 };
      await locks.request('nh-offline-sync', { ifAvailable: true }, async lock => {
        if (lock) result = await drainQueue();
      });
      return result;
    }
    return await drainQueue();
  } finally {
    syncing = false;
  }
}

/** Re-queue a failed item (and anything it was blocking) for the next run. */
export async function retryItem(item: QueueItem): Promise<void> {
  item.status = 'pending';
  item.error = undefined;
  item.blockedBy = undefined;
  await updateItem(item);
  // Children failed with "waiting on this item" become eligible again.
  if (item.tempId) {
    const tempId = item.tempId;
    for (const dep of await listOwnQueue()) {
      if (dep.status === 'failed' && dep.blockedBy && depsOf(dep).includes(tempId)) {
        dep.status = 'pending';
        dep.error = undefined;
        dep.blockedBy = undefined;
        await updateItem(dep);
      }
    }
  }
  void syncQueue();
}

let started = false;

/** Idempotent global wiring of the sync triggers (app start, back online, tab visible). */
export function startSyncTriggers(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => void syncQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncQueue();
  });
  // App start (deferred so login state settles first).
  setTimeout(() => void syncQueue(), 3000);
}
