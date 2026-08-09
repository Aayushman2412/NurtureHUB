/**
 * Offline mutation queue (see db.ts for the schema).
 *
 * Every enqueue/removal dispatches `nh-offline-changed` so badges and lists
 * re-render without polling IndexedDB.
 *
 * Ownership: items are stamped with the capturing user (JWT `sub`) and are
 * invisible to — and never synced by — any other account on the same device.
 */
import { getDB, newId, type MediaItem, type QueueItem, type QueueKind } from './db';

export const OFFLINE_CHANGED_EVENT = 'nh-offline-changed';

function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED_EVENT));
}

/** JWT `sub` (email) of the logged-in user, or null when logged out. */
export function currentOwner(): string | null {
  const token = localStorage.getItem('nh_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** True when the item belongs to the current user (legacy unowned items count). */
export function ownedByCurrentUser(item: QueueItem): boolean {
  if (!item.owner) return true;
  const owner = currentOwner();
  return owner !== null && item.owner === owner;
}

/** Normalized dependency list (dependsOn was historically a single string). */
export function depsOf(item: QueueItem): string[] {
  if (!item.dependsOn) return [];
  return Array.isArray(item.dependsOn) ? item.dependsOn : [item.dependsOn];
}

export interface EnqueueInput {
  kind: QueueKind;
  label: string;
  payload: Record<string, unknown>;
  route?: Record<string, string | number>;
  dependsOn?: string[];
  tempId?: string;
}

export async function enqueue(input: EnqueueInput): Promise<QueueItem> {
  const db = await getDB();
  const item: QueueItem = {
    id: newId(),
    kind: input.kind,
    createdAt: Date.now(),
    status: 'pending',
    attempts: 0,
    owner: currentOwner() ?? undefined,
    label: input.label,
    dependsOn: input.dependsOn && input.dependsOn.length > 0 ? input.dependsOn : undefined,
    tempId: input.tempId,
    payload: input.payload,
    route: input.route ?? {},
  };
  await db.put('queue', item);
  notifyChanged();
  return item;
}

/** Every queued item, all owners (sync engine + internal bookkeeping). */
export async function listQueue(): Promise<QueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('queue', 'by-created');
}

/** The current user's queued items — what badges, lists and sync act on. */
export async function listOwnQueue(): Promise<QueueItem[]> {
  return (await listQueue()).filter(ownedByCurrentUser);
}

export async function queueCount(): Promise<number> {
  return (await listOwnQueue()).length;
}

export async function updateItem(item: QueueItem): Promise<void> {
  const db = await getDB();
  await db.put('queue', item);
  notifyChanged();
}

export async function findByTempId(tempId: string): Promise<QueueItem | undefined> {
  return (await listQueue()).find(i => i.tempId === tempId);
}

/** Deep-replace one media marker with '' (its photo was discarded). */
function stripMediaMarker(node: unknown, marker: string): unknown {
  if (typeof node === 'string') return node === marker ? '' : node;
  if (Array.isArray(node)) return node.map(v => stripMediaMarker(v, marker));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = stripMediaMarker(v, marker);
    }
    return out;
  }
  return node;
}

/**
 * Remove a queue item.
 *
 * Dependents are not left to rot ("pending forever" is invisible data loss):
 *  - removing a MEDIA item rewrites dependents' payloads to drop the photo
 *    (the record still syncs, just without the discarded image);
 *  - removing a mother/child/response cascades to items that can only exist
 *    under it — a child of a discarded offline mother can never sync.
 */
export async function removeItem(id: string): Promise<void> {
  const db = await getDB();
  const item = await db.get('queue', id);
  await db.delete('queue', id);
  // A discarded media item's blob is unreachable — drop it too.
  if (item?.kind === 'media' && item.tempId) await db.delete('media', item.tempId);

  // Cascade ONLY when the parent never reached the server: a synced parent's
  // tempId resolves via the idmap, and its dependents sync normally. A
  // discarded (never-synced) parent leaves dependents that can never sync.
  if (item?.tempId && (await resolveId(item.tempId)) === undefined) {
    const dependents = (await listQueue()).filter(i => depsOf(i).includes(item.tempId!));
    for (const dep of dependents) {
      if (item.kind === 'media') {
        dep.payload = stripMediaMarker(dep.payload, `${OFFLINE_MEDIA_PREFIX}${item.tempId}`) as Record<string, unknown>;
        dep.dependsOn = depsOf(dep).filter(d => d !== item.tempId);
        if (dep.blockedBy) {
          dep.status = 'pending';
          dep.error = undefined;
          dep.blockedBy = undefined;
        }
        await db.put('queue', dep);
      } else {
        await removeItem(dep.id);
      }
    }
  }
  notifyChanged();
}

/** Direct dependents of an item, for the discard-confirm message. */
export async function countDependents(item: QueueItem): Promise<number> {
  if (!item.tempId) return 0;
  const tempId = item.tempId;
  return (await listQueue()).filter(i => depsOf(i).includes(tempId)).length;
}

export async function storeMedia(file: File): Promise<string> {
  const db = await getDB();
  const id = newId();
  const media: MediaItem = { id, blob: file, name: file.name, type: file.type };
  await db.put('media', media);
  return id;
}

export async function getMedia(id: string): Promise<MediaItem | undefined> {
  const db = await getDB();
  return db.get('media', id);
}

export async function mapId(tempId: string, realId: number | string, kind: QueueKind): Promise<void> {
  const db = await getDB();
  await db.put('idmap', { tempId, realId, kind });
}

export async function resolveId(tempId: string): Promise<number | string | undefined> {
  const db = await getDB();
  return (await db.get('idmap', tempId))?.realId;
}

/** Marker prefix for values/ids that still point at local temp entities. */
export const TEMP_PREFIX = 'tmp-';
export const OFFLINE_MEDIA_PREFIX = 'offline-media:';

export function isTempId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(TEMP_PREFIX);
}

export function newIdWithPrefix(): string {
  return TEMP_PREFIX + newId();
}

/** Rewrite one temp id / offline-media marker to its server value, if known. */
export async function remapValue(value: unknown): Promise<unknown> {
  if (typeof value !== 'string') return value;
  if (value.startsWith(TEMP_PREFIX)) {
    const real = await resolveId(value);
    return real ?? value;
  }
  if (value.startsWith(OFFLINE_MEDIA_PREFIX)) {
    const real = await resolveId(value.slice(OFFLINE_MEDIA_PREFIX.length));
    return real ?? value;
  }
  return value;
}

/** Deep-rewrite temp ids / offline-media markers anywhere in the payload. */
export async function remapDeep<T>(node: T): Promise<T> {
  if (Array.isArray(node)) {
    return Promise.all(node.map(item => remapDeep(item))) as Promise<T>;
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = await remapDeep(value);
    }
    return out as T;
  }
  return (await remapValue(node)) as T;
}

/**
 * TempIds a payload still references with no server id yet: `tmp-` subject
 * ids and `offline-media:` photo markers. A payload with unresolved markers
 * must NEVER be sent to the server — the marker string would be stored
 * verbatim and the photo silently lost.
 */
export function collectUnresolvedMarkers(node: unknown, out: Set<string> = new Set()): string[] {
  if (typeof node === 'string') {
    if (node.startsWith(TEMP_PREFIX)) out.add(node);
    else if (node.startsWith(OFFLINE_MEDIA_PREFIX)) out.add(node.slice(OFFLINE_MEDIA_PREFIX.length));
  } else if (Array.isArray(node)) {
    for (const v of node) collectUnresolvedMarkers(v, out);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) collectUnresolvedMarkers(v, out);
  }
  return [...out];
}

/** Discard a queued offline photo by its media id (user removed it from the form). */
export async function discardQueuedMedia(mediaId: string): Promise<void> {
  const item = await findByTempId(mediaId);
  if (item?.kind === 'media') await removeItem(item.id);
}
