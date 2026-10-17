/**
 * usePasswordCheck — the server's password rules, checked live.
 *
 * Fetches GET /api/auth/password-policy once per session (learner and admin
 * variants cached separately) and runs lib/passwordRules against what the
 * person has typed. Until the policy arrives — or if it cannot — the form uses
 * FALLBACK_POLICY; the server still has the final word on submit.
 */
import { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import {
  FALLBACK_POLICY, checkPassword, isEasyToGuess, meetsPolicy,
  type CheckContext, type PasswordPolicy, type RuleResult,
} from '../lib/passwordRules';

const cache: Partial<Record<'learner' | 'admin', Promise<PasswordPolicy>>> = {};

function loadPolicy(isAdmin: boolean): Promise<PasswordPolicy> {
  const key = isAdmin ? 'admin' : 'learner';
  if (!cache[key]) {
    cache[key] = client
      .get(`/api/auth/password-policy?is_admin=${isAdmin}`)
      .then(r => ({ ...FALLBACK_POLICY, ...r.data }) as PasswordPolicy)
      .catch(() => {
        delete cache[key];          // try again next time the form opens
        return isAdmin
          ? { ...FALLBACK_POLICY, style: 'strict', min_length: 12 }
          : FALLBACK_POLICY;
      });
  }
  return cache[key]!;
}

export interface PasswordCheck {
  policy: PasswordPolicy;
  results: RuleResult[];
  ok: boolean;
  /** Learners: allowed, but easy to guess — say so, never refuse. */
  easy: boolean;
}

export function usePasswordCheck(password: string, ctx: CheckContext & { isAdmin?: boolean } = {}): PasswordCheck {
  const isAdmin = Boolean(ctx.isAdmin);
  const [policy, setPolicy] = useState<PasswordPolicy>(FALLBACK_POLICY);

  useEffect(() => {
    let alive = true;
    loadPolicy(isAdmin).then(p => { if (alive) setPolicy(p); });
    return () => { alive = false; };
  }, [isAdmin]);

  const results = useMemo(
    () => checkPassword(password, policy, { email: ctx.email, fullName: ctx.fullName, includeHistory: ctx.includeHistory }),
    [password, policy, ctx.email, ctx.fullName, ctx.includeHistory],
  );
  const easy = useMemo(
    () => policy.style === 'simple' && isEasyToGuess(password, policy, { email: ctx.email, fullName: ctx.fullName }),
    [password, policy, ctx.email, ctx.fullName],
  );
  return { policy, results, ok: meetsPolicy(results), easy };
}
