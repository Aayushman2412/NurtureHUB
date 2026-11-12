/**
 * Where a test attempt's local draft (start time, answers so far) is kept.
 *
 * Drafts written before the rename to EduPoshan sit under the old key. A test
 * that is in progress while the new version deploys must not lose its answers,
 * so the first read moves an old draft to the new key.
 */
const ATTEMPT_PREFIX = 'eduposhan_attempt_';
const LEGACY_ATTEMPT_PREFIX = 'nurturehub_attempt_';

export function attemptStorageKey(attemptId: string | number | undefined): string {
  const key = `${ATTEMPT_PREFIX}${attemptId}`;
  const legacyKey = `${LEGACY_ATTEMPT_PREFIX}${attemptId}`;
  try {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // Storage blocked (private mode): there is no draft to carry over.
  }
  return key;
}
