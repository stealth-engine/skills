---
name: nextjs-locale-standalone
description: Add locale-prefixed i18n routing to a single (non-monorepo) Next.js App Router site — a middleware/proxy that redirects `/` and any unprefixed path to `/<locale>/…` using the locale toggle's last choice (the NEXT_LOCALE cookie) then the browser's Accept-Language, a `[locale]` layout with a LocaleProvider + hooks, and a LocaleToggle that persists the choice. Use when adding bilingual/multilingual routing to a standalone Next.js site, building `/en-hk/…` `/zh-hk/…` URL namespaces, redirecting the root to a default-or-remembered locale, persisting a language switch across visits, or detecting browser language in middleware. For a monorepo that shares this logic across several apps via a workspace package, use nextjs-locale-monorepo instead.
metadata:
  author: stealth-engine
  version: "1.0.0"
---

# Next.js locale routing — standalone site

Locale-prefixed routing for one Next.js App Router app, no shared package. Every
page lives under `/<locale>/…`; a proxy (middleware) sends unprefixed requests to
the right locale. Drop-in copy-paste files are in [`templates/`](./templates).

> Sibling skill: **nextjs-locale-monorepo** — the same behaviour factored into a
> shared workspace package for multi-app repos. Keep the two in sync.

## The behaviour (the spec both skills implement)

- **URLs are locale-namespaced:** `/en-hk/about`, `/zh-hk/about`. One locale is
  the default.
- **The proxy redirects unprefixed paths.** A request to `/about` (or `/`) with no
  known locale prefix is 307-redirected to `/<locale>/about`, preserving query +
  hash. The locale is resolved by this **priority**:
  1. **`NEXT_LOCALE` cookie** — the toggle's last choice (if the visitor has ever switched).
  2. **`Accept-Language`** — the browser's preferred language (exact match, then language-only, e.g. `zh` → `zh-hk`).
  3. **Default locale.**
- **Already-prefixed paths pass through** (`NextResponse.next()`), and the proxy
  stamps the response: `x-locale` header, `Vary: Accept-Language, Cookie`, and
  (re)writes `NEXT_LOCALE` when it differs.
- **The toggle persists via that cookie.** The LocaleToggle just navigates to
  `/<newLocale>/…`; the proxy, seeing a prefixed path, writes `NEXT_LOCALE` — so
  the next time the visitor lands on `/`, step 1 sends them back to that choice.
  (The toggle doesn't set the cookie itself; the proxy is the single writer.)

## Files to create

| File | Role |
| --- | --- |
| `lib/i18n.ts` | `supportedLanguages`, `locales`, `defaultLocale`, cookie name, and pure detection helpers (no Next imports) |
| `proxy.ts` (Next 16) / `middleware.ts` (≤15) | the redirect + stamp logic |
| `app/[locale]/layout.tsx` | validates the locale, `generateStaticParams`, renders `<html lang>`, wraps in `LocaleProvider` |
| `app/locale-provider.tsx` | `'use client'` context + `useCurrentLocale` / `useIsLocale` |
| `components/LocaleToggle.tsx` | switches locale by rewriting the first path segment |

Copy them from [`templates/`](./templates) and adjust `supportedLanguages`.

## Wiring steps

1. **Define locales** in `lib/i18n.ts` (`{ id, title, isDefault? }[]`).
2. **Move pages under `app/[locale]/`.** In the App Router the *topmost* layout
   must render `<html>` + `<body>`. The clean setup is to make
   `app/[locale]/layout.tsx` that root layout and have **no `app/layout.tsx`** —
   valid as long as every page lives under `[locale]`. (`app/globals.css`,
   `app/global-error.tsx`, `app/api/*`, `app/icon.png` stay at `app/`.) If you
   keep an `app/layout.tsx`, make it a pass-through that returns `children` and
   move `<html>`/`<body>` into the `[locale]` layout — never render them twice.
3. **Add the proxy** at the project root and the matcher (below).
4. **Add the toggle** somewhere in the layout/nav.

## Next 16: `proxy.ts` vs `middleware.ts`

Next 16 renamed the convention: the file is `proxy.ts` and the export is
`export function proxy(...)`. On Next ≤15 it's `middleware.ts` /
`export function middleware(...)` — **the body is identical**, only the file and
function names change. Next 16 still runs a `middleware.ts` but logs a deprecation
warning. The template ships as `proxy.ts`.

The matcher excludes assets and API so they never redirect:

```ts
export const config = { matcher: ['/((?!_next|api|.*\\..*).*)'] };
```

Also guard inside the function (`shouldSkip`) for `/_next`, `/api`,
`/.well-known`, `/favicon`, and anything with a file extension — the matcher and
the guard are belt-and-suspenders.

## Gotchas

- **Cookie is `httpOnly: false`** so client code/analytics can read the active
  locale; it's not a secret. `sameSite: 'lax'`, `secure` on HTTPS, 1-year `maxAge`.
- **Set `Vary: Accept-Language, Cookie`** (the proxy does) so a CDN never serves
  one visitor's locale to another.
- **Language-only fallback matters:** a browser sending `zh-TW` or `zh` should
  resolve to your `zh-hk`. The matcher in `lib/i18n.ts` tries exact, then the
  primary subtag.
- **Don't redirect-loop:** only redirect when `extractLocaleFromPath` returns
  null. Prefixed paths must pass through.
- **Locale validity in the layout:** `notFound()` for an unknown `[locale]` so
  `/xx/...` 404s instead of rendering.

## Verify

- `curl -sI localhost:3000/` → `307` to `/<default>/` (no cookie, no Accept-Language).
- `curl -sI -H 'Accept-Language: zh-HK' localhost:3000/about` → `307` to `/zh-hk/about`.
- `curl -sI --cookie 'NEXT_LOCALE=zh-hk' localhost:3000/` → `307` to `/zh-hk/` even with an English `Accept-Language` (cookie wins).
- Visiting `/zh-hk/x` sets `NEXT_LOCALE=zh-hk` in the response `Set-Cookie`.
