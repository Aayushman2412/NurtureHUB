/**
 * useMeasurementCheck — the server's measurement checks for a growth check
 * while it is being filled (visit protocol, Nov 2026; backend
 * app/growth_entry_checks.py). Once the weight or length has been entered it
 * asks POST /api/growth/my-cases/{child}/measurement-check, so the runner can
 * say "measure again, or is it right?" straight away.
 *
 * The rules are not copied here: the server's answer is shown as it is. With
 * no network the check is skipped — the save is never blocked — and the server
 * records any flag when the queued save reaches it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkMeasurement, type CheckCode, type CheckFlag } from '../api/growthStatus';

const DEBOUNCE_MS = 400;

const toNumber = (raw: string): number | null => {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface MeasurementCheckState {
  /** The flags for the values as they are now (empty until checked). */
  flags: CheckFlag[];
  /** Codes the learner said are right, for the values as they are now. */
  confirmed: CheckCode[];
  /** Mark every flag on this field as right. */
  confirm: (field: CheckFlag['field']) => void;
  /** Check now (on Submit); resolves with the flags not yet confirmed — [] when it cannot check. */
  flush: () => Promise<CheckFlag[]>;
}

export function useMeasurementCheck(args: {
  childId: number | null;
  responseId: number | null;
  assessmentDate: string;
  weight: string;
  length: string;
  /** Check as the values change (after the learner has left the field). */
  live: boolean;
}): MeasurementCheckState {
  const { childId, responseId, assessmentDate } = args;
  const weight = toNumber(args.weight);
  const length = toNumber(args.length);
  const signature = `${assessmentDate}|${weight ?? ''}|${length ?? ''}`;
  const [result, setResult] = useState<{ signature: string; flags: CheckFlag[] } | null>(null);
  /** code → the values it was confirmed for. */
  const [agreed, setAgreed] = useState<Partial<Record<CheckCode, string>>>({});
  const latest = useRef(0);

  const ask = useCallback(async (): Promise<CheckFlag[] | null> => {
    if (childId == null || (weight == null && length == null)) return [];
    const mine = ++latest.current;
    try {
      const got = await checkMeasurement(childId, { assessment_date: assessmentDate, weight, length, response_id: responseId });
      if (mine === latest.current) setResult({ signature, flags: got.flags });
      return got.flags;
    } catch {
      return null;      // offline or refused: say nothing, never block
    }
  }, [childId, responseId, assessmentDate, weight, length, signature]);

  useEffect(() => {
    if (!args.live) return undefined;
    const id = window.setTimeout(() => { void ask(); }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [args.live, ask]);

  const flags = useMemo(() => (result?.signature === signature ? result.flags : []), [result, signature]);
  const confirmed = useMemo(
    () => flags.map(f => f.code).filter(c => agreed[c] === signature),
    [flags, agreed, signature],
  );

  const confirm = useCallback((field: CheckFlag['field']) => {
    setAgreed(prev => {
      const next = { ...prev };
      for (const f of flags) if (f.field === field) next[f.code] = signature;
      return next;
    });
  }, [flags, signature]);

  const flush = useCallback(async () => {
    const now = result?.signature === signature ? result.flags : await ask();
    return (now ?? []).filter(f => agreed[f.code] !== signature);
  }, [result, signature, ask, agreed]);

  return { flags, confirmed, confirm, flush };
}
