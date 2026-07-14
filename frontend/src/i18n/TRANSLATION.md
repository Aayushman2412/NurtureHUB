# Translations — status & how-to

## Status

| Language | Code | Namespaces | Status |
|----------|------|-----------|--------|
| English | `en` | common, auth | ✅ source of truth |
| Hindi | `hi` | common, auth | ⚠️ **machine-drafted — pending human review** |

The Hindi files (`locales/hi/*.json`) were drafted automatically and **need a
fluent Hindi + ICDS-domain reviewer** to confirm terminology (see
[`glossary.md`](./glossary.md)) and tone before this is treated as production-ready.

## Structure

- `locales/<lang>/<namespace>.json` — one file per language per namespace.
- Namespaces so far: `common` (brand, footer, language) and `auth` (all the
  login / signup / OTP / forgot-password / Google screens).
- English is `fallbackLng`, so any missing key in another language automatically
  renders the English string — a partial translation never breaks a page.

## Adding a language

1. Add the locale JSONs under `locales/<code>/`.
2. Add `{ code, label, native }` to `SUPPORTED_LANGUAGES` in `index.ts` and import
   the new resources there.
3. That's it — the switcher and detection pick it up automatically.

## Adding a string

1. Add the key to the **English** file first (source of truth).
2. Use it via `const { t } = useTranslation('auth'); t('login.signIn')`.
3. Add the translation to each other language's file (English fallback covers the gap until then).

## Conventions

- Keys are `screen.element` (e.g. `login.signInSubtitle`), with a nested `toast.*`
  group for transient messages.
- Interpolation uses `{{name}}` (e.g. `otp.subtitle`).
- Avoid splitting a sentence across multiple keys/JSX (word order differs by
  language) — keep a clickable phrase like "Back to Sign In" as one key.
