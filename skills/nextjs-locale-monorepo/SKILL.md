---
name: nextjs-locale-monorepo
description: Add locale-prefixed i18n routing across a Next.js monorepo (Turborepo / pnpm workspaces) by extracting the engine into a shared workspace package that every app consumes — locale detection + a middleware/proxy factory + a `use client` LocaleProvider/hooks, plus a shared supportedLanguages config. Each app redirects `/` and unprefixed paths to `/<locale>/…` from the toggle's last choice (the NEXT_LOCALE cookie) then the browser's Accept-Language, wiring only a thin middleware + `[locale]` layout. Use when several apps in one repo need consistent `/en-hk/…` `/zh-hk/…` routing, sharing locale logic via a workspace package instead of copy-paste, dual ESM/CJS build of a package that ships a client provider, Turbo build-ordering so the lib builds before the apps, or per-app locale wiring. For a single standalone site, use nextjs-locale-standalone instead.
metadata:
  author: stealth-engine
  version: "1.0.1"
---

# Next.js locale routing — monorepo (shared package)

The same locale-routing behaviour as **nextjs-locale-standalone**, but the engine
lives in one workspace package (`i18n-routing`) that every app imports, so
detection, the cookie name, and the provider/hooks stay identical across apps.
Read that sibling skill for the behaviour spec; this skill is about the
**package + wiring**. Copy-paste files are in [`templates/`](./templates).

## The behaviour (shared with the standalone skill)

Unprefixed requests 307-redirect to `/<locale>/…`, locale chosen by priority:
**`NEXT_LOCALE` cookie (toggle's last choice) → `Accept-Language` (browser) →
default**. The redirect carries `Vary: Accept-Language, Cookie` (its locale was
negotiated from them); prefixed paths pass through with `x-locale` + the
`NEXT_LOCALE` cookie stamped but **no** such `Vary` (their locale is fixed by the
URL, so it'd only fragment the cache). The LocaleToggle navigates to `/<newLocale>/…`; the
middleware is the single writer of the cookie, so the choice persists. Full
explanation + a toggle template: see **nextjs-locale-standalone**.

## Architecture

```
packages/
  i18n-routing/          # the engine — detection, middleware factory, provider/hooks
    src/{config,utils,middleware,provider,hooks,client,index}.ts(x)
    package.json         # exports: "." (server) + "./client" (provider/hooks)
    tsup.config.ts       # dual CJS/ESM, dts, preserves "use client"
  configs/               # shared supportedLanguages (one source of truth)
apps/
  web/  marketing/  …    # each: a thin middleware.ts + app/[locale]/layout.tsx
```

Two packages, deliberately:

- **`i18n-routing`** — the logic. Ships **two entry points**: the default export
  is server-safe (config + utils + middleware factory); `i18n-routing/client` is
  the `'use client'` provider + hooks. Keeping them separate stops the
  `'use client'` boundary from poisoning middleware/server imports.
- **`configs`** (or any shared package) — exports `supportedLanguages`
  (`{ id, title, isDefault? }[]`). Apps and the middleware read locales from here,
  so adding a language is a one-line change in one place.

## Building the package (the parts that bite)

Use the [`templates/package/`](./templates/package) files as-is. What matters:

- **Dual build with tsup**, two entries (`index`, `client`), `format: ['cjs','esm']`,
  `dts: true`, `external: ['react','react-dom','next']`, and crucially
  **`treeshake: false`** — tree-shaking strips the `'use client'` directive and
  the provider breaks at runtime. (`templates/package/tsup.config.ts`.)
- **`exports` map** with `.` and `./client`, each pointing at `types` + `import`
  (esm) + `require` (cjs). (`templates/package/package.json`.)
- **Peer deps** `next`, `react`, `react-dom` — never bundle them.
- The middleware factory `createI18nMiddleware(config)` is **pure logic** — it
  returns `NextResponse | undefined` and imports nothing app-specific, so it is
  unit-testable without a running app.

## Wiring each app

1. **Depend on both packages** in the app's `package.json`:
   `"i18n-routing": "workspace:^"`, `"configs": "workspace:^"`.
2. **Thin `middleware.ts`** (`templates/app-middleware.ts`): build the config from
   the shared languages and delegate. This is also where you compose app-specific
   middleware (auth, an `anon_id` cookie, feature-flag gating) around the i18n
   redirect.

   ```ts
   import { supportedLanguages } from 'configs/locale';
   import { createI18nMiddleware, i18nConfig } from 'i18n-routing';

   const i18n = createI18nMiddleware(i18nConfig(supportedLanguages));
   export function middleware(req: NextRequest) {
     return i18n(req) ?? NextResponse.next();
   }
   export const config = { matcher: ['/((?!_next|api|.*\\..*).*)'] };
   ```

3. **`app/[locale]/layout.tsx`** (`templates/app-locale-layout.tsx`): validate the
   locale, `generateStaticParams` from `supportedLanguages`, and wrap children in
   `LocaleProvider` from **`i18n-routing/client`** (not the root import). This is
   the root layout — render `<html lang={locale}>`/`<body>` here and keep no
   `app/layout.tsx` (every page lives under `[locale]`).

## Turbo / pnpm specifics

- **Build order:** apps depend on the built package. Add the dependency in
  `turbo.json` so the lib is built first:

  ```jsonc
  "your-app#build": { "dependsOn": ["i18n-routing#build", "configs#build"], "outputs": [".next/**"] },
  "your-app#dev":   { "dependsOn": ["i18n-routing#build", "configs#build"], "persistent": true }
  ```

  Run the package in watch mode (`tsup --watch`) during development so app HMR
  picks up engine edits.
- **Type skew across pnpm-hoisted `next` versions:** if an app pins a different
  `next` than the package's peer range, `NextRequest` types can mismatch and TS
  complains at the `i18n(req)` call. The pragmatic fix used in production is a
  localized cast — `i18n(req as any)` — with a comment; it's a types-only skew,
  the runtime shape is identical. Prefer aligning `next` versions when you can.
- **Don't re-export `'use client'` code from the root entry.** Importing the
  provider via the default entry drags a client boundary into server/middleware
  graphs. Always import hooks/provider from `i18n-routing/client`.

## Adding a locale (the payoff)

Add one `{ id, title }` to `supportedLanguages` in `configs`. Every app's
middleware, `generateStaticParams`, toggle, and detection pick it up — no per-app
change. That single source of truth is the whole reason to use a package over
copy-paste.

## Verify (per app)

- `curl -sI localhost:3000/` → `307` to `/<default>/`.
- `curl -sI -H 'Accept-Language: zh-HK' localhost:3000/x` → `307` to `/zh-hk/x`.
- `curl -sI --cookie 'NEXT_LOCALE=zh-hk' localhost:3000/` → `307` to `/zh-hk/` (cookie beats Accept-Language).
- `pnpm --filter i18n-routing build` succeeds and `dist/client.*` keeps its `"use client"` banner.
