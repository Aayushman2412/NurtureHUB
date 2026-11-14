/**
 * Is a typed name a real one? The browser's copy of backend
 * app/name_checks.py (Learner Redesign review, 30 Oct 2026, fix 5: records
 * named "mother name", "Tttttt" and "Gghghgh" were saved as real mothers),
 * so the learner hears it on the page instead of after the last step. The
 * server is authoritative and checks again; keep the two in step.
 *
 * Only Latin letters are judged by their pattern; a name typed in an Indian
 * script is judged on the word list and digits alone.
 */

const PLACEHOLDERS = new Set([
  'name', 'mother', 'mother name', 'mothers name', "mother's name", 'full name', 'beneficiary',
  'test', 'testing', 'tester', 'demo', 'sample', 'dummy', 'example', 'abc', 'abcd', 'xyz', 'asdf',
  'qwerty', 'na', 'n a', 'none', 'nil', 'unknown', 'no name', 'xxx', 'aaa',
]);
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

export type PlaceholderReason = 'placeholder' | 'digits' | 'repeated' | 'mash' | 'no_vowel';

/** Why `name` looks like a placeholder, or null when it looks like a name. */
export function placeholderReason(name: string): PlaceholderReason | null {
  const text = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;
  const lettersOnly = text.replace(/[^a-z' ]/g, '').replace(/'/g, '').trim();
  if (PLACEHOLDERS.has(lettersOnly) || PLACEHOLDERS.has(text)) return 'placeholder';
  if (/\d/.test(text)) return 'digits';
  const letters = (text.match(/[a-z]/g) ?? []).join('');
  if (letters.length < 4) return null;
  const distinct = new Set(letters);
  if (distinct.size === 1) return 'repeated';
  if (distinct.size === 2 && letters.length >= 5) return 'mash';
  if (![...distinct].some(c => VOWELS.has(c))) return 'no_vowel';
  return null;
}
