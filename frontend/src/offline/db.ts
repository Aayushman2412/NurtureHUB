/**
 * IndexedDB layer for offline field work (via `idb`).
 *
 * Stores:
 *  - queue: pending mutations captured while offline — mother/child
 *    registrations and form-response submissions — replayed in dependency
 *    order by sync.ts.
 *  - idmap: client temp-id -> server id mappings established as queued
 *    creations sync (children queued under an offline mother, media URLs
 *    referenced by queued answers).
 *  - media: image blobs picked while offline; uploaded before the answers
 *    that reference them.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type QueueKind = 'media' | 'mother' | 'child' | 'response_create' | 'response_update';
export type QueueStatus = 'pending' | 'failed';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  createdAt: number;
  status: QueueStatus;
  /** Attempts so far; failures keep the item with the server detail. */
  attempts: number;
  error?: string;
  /**
   * Who captured this record (JWT `sub` = email). Items only ever sync under
   * their owner's token — a shared device must not attribute user A's field
   * work to user B after a re-login. Items missing an owner (pre-upgrade)
   * are treated as the current user's.
   */
  owner?: string;
  /** Human label for the pending-sync UI ("Mother: Sunita", "BF — Rahul"). */
  label: string;
  /**
   * TempIds of queue items this one cannot sync before (its offline mother/
   * child registration, its offline photos). Historically a single string.
   */
  dependsOn?: string | string[];
  /** Label of a failed parent currently blocking this item (UI display). */
  blockedBy?: string;
  /** Local placeholder id minted for creations (mother/child/media/response). */
  tempId?: string;
  /** Endpoint payload (JSON-safe); media items keep their blob in `media`. */
  payload: Record<string, unknown>;
  /** Extra routing info: formKey, motherId, childId, responseId. */
  route: Record<string, string | number>;
}

export interface IdMapEntry {
  tempId: string;
  realId: number | string;
  kind: QueueKind;
}

export interface MediaItem {
  id: string;
  blob: Blob;
  name: string;
  type: string;
}

interface OfflineDB extends DBSchema {
  queue: { key: string; value: QueueItem; indexes: { 'by-created': number } };
  idmap: { key: string; value: IdMapEntry };
  media: { key: string; value: MediaItem };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>('nh-offline', 1, {
      upgrade(db) {
        const queue = db.createObjectStore('queue', { keyPath: 'id' });
        queue.createIndex('by-created', 'createdAt');
        db.createObjectStore('idmap', { keyPath: 'tempId' });
        db.createObjectStore('media', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export function newId(): string {
  return crypto.randomUUID();
}
