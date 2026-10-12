/**
 * One search behaviour for every list of learners (review of 5 Oct 2026):
 * the user ID first — the one thing unique in a project — then the mobile
 * number, then name, cadre, block, district and email.
 *
 *   "123" / "#123" / "id 123"  → user ID 123 (and IDs starting 123…)
 *   "98331" (4+ digits)        → also any mobile containing those digits
 *   "asha jalna"               → every word must match somewhere
 */
export interface LearnerSearchable {
  id?: number | string | null;
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  cadre?: string | null;
  cadreShort?: string | null;
  block?: string | null;
  district?: string | null;
  /** Anything else worth finding the learner by (mother ID, batch …). */
  extra?: (string | number | null | undefined)[];
}

const ID_PREFIX = /^(#|user\s*id\s*:?\s*|id\s*:?\s*)/i;

export function matchesLearner(query: string, l: LearnerSearchable): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const idQuery = q.replace(ID_PREFIX, '').trim();
  if (/^\d+$/.test(idQuery)) {
    const id = l.id == null ? '' : String(l.id);
    // An explicit "#12" / "id 12" asks for that ID only.
    if (ID_PREFIX.test(q)) return id === idQuery;
    if (id && id.startsWith(idQuery)) return true;
    const mobile = (l.mobile ?? '').replace(/\D/g, '');
    return idQuery.length >= 4 && mobile.includes(idQuery);
  }

  const haystack = [
    l.name, l.email, l.cadre, l.cadreShort, l.block, l.district, l.mobile,
    l.id == null ? null : String(l.id), ...(l.extra ?? []),
  ].filter(v => v != null && v !== '').map(v => String(v).toLowerCase()).join(' \u0001 ');
  return q.split(/\s+/).every(word => haystack.includes(word));
}
