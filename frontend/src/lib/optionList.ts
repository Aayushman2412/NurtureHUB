/**
 * Turning pasted spreadsheet text into a list of answer options.
 *
 * Typing a few hundred village or facility names one at a time is not a real
 * option, so the builders accept a paste straight out of Excel — the same
 * affordance Google Forms has. Excel puts a TAB between cells copied across a
 * row and a NEWLINE between cells copied down a column, so those are the two
 * separators we split on.
 *
 * Commas are deliberately NOT separators: real labels contain them
 * ("Ward 4, Block B"), and splitting there would quietly mangle the list.
 */

/** True when pasted text carries more than one cell — i.e. worth bulk-adding. */
export const isMultiOptionPaste = (text: string): boolean => parseOptionLabels(text).length > 1;

/** Pasted text → trimmed, de-duplicated labels in the order they appeared. */
export function parseOptionLabels(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cell of text.split(/[\r\n\t]+/)) {
    // Excel wraps a cell containing a newline in quotes; drop those wrappers.
    const label = cell.trim().replace(/^"(.*)"$/s, '$1').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * A stable machine value for an option label.
 *
 * Labels are often Devanagari, so this keeps any non-space character rather
 * than stripping to `[a-z0-9_]` (which would empty a Hindi label). `taken`
 * carries the values already in use so a repeated or unsluggable label still
 * gets a unique value instead of colliding with an existing answer.
 */
export function makeOptionValue(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.trim().toLowerCase().replace(/\s+/g, '_').replace(/["'`]/g, '') || 'option';
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/**
 * Append pasted labels to an existing option list, skipping any label already
 * present (case-insensitively) so re-pasting a corrected sheet does not double
 * the list.
 */
export function appendPastedOptions<T extends { label: string; value: string }>(
  existing: T[],
  text: string,
  make: (label: string, value: string) => T,
): { options: T[]; added: number; skipped: number } {
  const labels = parseOptionLabels(text);
  const haveLabels = new Set(existing.map(o => o.label.trim().toLowerCase()));
  const haveValues = new Set(existing.map(o => o.value));
  const options = [...existing];
  let added = 0;
  let skipped = 0;
  for (const label of labels) {
    if (haveLabels.has(label.toLowerCase())) {
      skipped += 1;
      continue;
    }
    const value = makeOptionValue(label, haveValues);
    haveValues.add(value);
    haveLabels.add(label.toLowerCase());
    options.push(make(label, value));
    added += 1;
  }
  return { options, added, skipped };
}
