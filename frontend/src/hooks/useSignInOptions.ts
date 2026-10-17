/**
 * What the sign-in screens can offer on this deployment (GET /api/auth/options).
 *
 * Review of 17 Oct 2026: "Continue with Google" answered "Google sign-in is
 * not configured" on the live site, in front of the supervisor — anything
 * that does not work must not be on the screen. Google shows only when the
 * server AND this build both have a client ID; the WhatsApp code step only
 * when the server can send one.
 */
import { useEffect, useState } from 'react';
import client from '../api/client';

export interface SignInOptions {
  google: boolean;
  whatsapp_otp: boolean;
  whatsapp_configured: boolean;
}

const NONE: SignInOptions = { google: false, whatsapp_otp: false, whatsapp_configured: false };
let cached: Promise<SignInOptions> | null = null;

const load = () => {
  if (!cached) {
    cached = client.get<SignInOptions>('/api/auth/options')
      .then(r => ({ ...NONE, ...r.data }))
      .catch(() => { cached = null; return NONE; });
  }
  return cached;
};

const buildHasGoogle = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export function useSignInOptions(): SignInOptions {
  const [options, setOptions] = useState<SignInOptions>(NONE);
  useEffect(() => {
    let alive = true;
    load().then(o => { if (alive) setOptions({ ...o, google: o.google && buildHasGoogle }); });
    return () => { alive = false; };
  }, []);
  return options;
}
