/**
 * Crash/offline protection for in-progress form answers.
 *
 * The runners keep answers only in component memory — a refresh, crash or
 * accidental back-nav during field work loses everything. The vault mirrors
 * the answers map to localStorage on every change; it is cleared on a
 * successful save/queue or an explicit discard, so "vault has an entry" is
 * exactly "there is unsaved work to restore".
 *
 * (localStorage, not IndexedDB: answer maps are small and the write path must
 * be synchronous so it survives even an immediate tab kill.)
 */

const PREFIX = 'nh_wip:';

/**
 * Key shape: nh_wip:<owner>:<form>:<subject>:<responseId|tmp-id|new>.
 * Owner-scoped — a shared device must never restore (or leak) another
 * account's unsaved answers. The id segment accepts a queued visit's `tmp-`
 * id so edits of an offline-captured visit keep one continuous vault slot.
 */
export function vaultKey(
  formKey: string,
  subject: string | number,
  responseId?: number | string | null,
): string {
  const owner = localStorage.getItem('nh_user_email') ?? 'anon';
  return `${PREFIX}${owner}:${formKey}:${subject}:${responseId ?? 'new'}`;
}

export function vaultSave(key: string, answers: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), answers }));
  } catch {
    // Quota/private-mode failures must never break data entry.
  }
}

export function vaultLoad<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return (JSON.parse(raw) as { answers: T }).answers ?? null;
  } catch {
    return null;
  }
}

export function vaultClear(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
