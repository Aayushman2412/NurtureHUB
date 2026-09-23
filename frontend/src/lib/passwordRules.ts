/**
 * The password rules, checked in the browser as the person types.
 *
 * The SERVER decides (backend/app/security/passwords.py). This file mirrors
 * its checks so the form can tick each rule off live, using the numbers and
 * lists the server publishes at GET /api/auth/password-policy — change a
 * number there and the form follows. FALLBACK_POLICY is only for when that
 * request fails; the server still has the final word on submit.
 */

export interface PasswordPolicy {
  min_length: number;
  max_length: number;
  history_depth: number;
  min_character_kinds: number;
  passphrase_length: number;
  min_distinct_characters: number;
  max_repeat: number;
  keyboard_run_length: number;
  keyboard_runs: string[];
  personal_token_length: number;
  common_passwords: string[];
}

export const FALLBACK_POLICY: PasswordPolicy = {
  min_length: 10,
  max_length: 128,
  history_depth: 5,
  min_character_kinds: 3,
  passphrase_length: 16,
  min_distinct_characters: 5,
  max_repeat: 3,
  keyboard_run_length: 5,
  keyboard_runs: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'],
  personal_token_length: 4,
  common_passwords: [],
};

export type RuleId = 'length' | 'variety' | 'common' | 'patterns' | 'personal' | 'spaces' | 'history';
/** pass / fail as typed; `pending` = nothing typed yet, or only the server can tell (history). */
export type RuleStatus = 'pass' | 'fail' | 'pending';

export interface RuleResult {
  id: RuleId;
  status: RuleStatus;
}

export interface CharacterKinds {
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
}

/** Code points, as Python counts them (an emoji is one character, not two). */
const length = (s: string) => [...s].length;

export function characterKinds(password: string): CharacterKinds {
  return {
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

function hasKeyboardRun(lowered: string, policy: PasswordPolicy): boolean {
  for (const run of policy.keyboard_runs) {
    for (let size = policy.keyboard_run_length; size <= run.length; size++) {
      for (let start = 0; start + size <= run.length; start++) {
        const chunk = run.slice(start, start + size);
        if (lowered.includes(chunk) || lowered.includes([...chunk].reverse().join(''))) return true;
      }
    }
  }
  return false;
}

function personalTokens(values: (string | undefined)[], minLength: number): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    for (const token of v.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length >= minLength) out.add(token);
    }
  }
  return [...out];
}

export interface CheckContext {
  email?: string;
  fullName?: string;
  /** Show "not one of your last N passwords" — resets and changes, not new accounts. */
  includeHistory?: boolean;
}

export function checkPassword(raw: string, policy: PasswordPolicy, ctx: CheckContext = {}): RuleResult[] {
  const password = raw.normalize('NFKC');
  const typed = password.length > 0;
  const lowered = password.toLowerCase();
  const n = length(password);
  const status = (ok: boolean): RuleStatus => (!typed ? 'pending' : ok ? 'pass' : 'fail');

  const kinds = characterKinds(password);
  const kindCount = Object.values(kinds).filter(Boolean).length;
  const common = new Set(policy.common_passwords);
  const repeat = new RegExp(`(.)\\1{${policy.max_repeat},}`, 'u');
  const tokens = personalTokens([ctx.email?.split('@')[0], ctx.fullName], policy.personal_token_length);

  const results: RuleResult[] = [
    { id: 'length', status: status(n >= policy.min_length && n <= policy.max_length) },
    { id: 'variety', status: status(n >= policy.passphrase_length || kindCount >= policy.min_character_kinds) },
    { id: 'common', status: status(!common.has(lowered) && !common.has(lowered.replace(/[^a-z]/g, ''))) },
    {
      id: 'patterns',
      status: status(
        new Set([...lowered]).size >= policy.min_distinct_characters
        && !repeat.test(password)
        && !hasKeyboardRun(lowered, policy),
      ),
    },
    { id: 'personal', status: status(!tokens.some(tok => lowered.includes(tok))) },
    { id: 'spaces', status: status(password === password.trim()) },
  ];
  if (ctx.includeHistory) results.push({ id: 'history', status: 'pending' });
  return results;
}

/** Every rule the browser can check is met (history is the server's to judge). */
export const meetsPolicy = (results: RuleResult[]) =>
  results.every(r => r.status === 'pass' || (r.id === 'history' && r.status === 'pending'));
