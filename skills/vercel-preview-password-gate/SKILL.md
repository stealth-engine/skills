---
name: vercel-preview-password-gate
description: A free DIY reimplementation of Vercel's $150/mo Advanced Deployment Protection add-on (Enterprise-only otherwise, unbuyable on Hobby) — its Password Protection and private/production gating, plus a better Protection Bypass for Automation (many named, individually revocable tokens vs Vercel's one project-wide secret). A self-contained middleware gate for ANY framework on Vercel (Next.js proxy/middleware, or SvelteKit/Nuxt/Astro/Remix/static sites via framework-agnostic Routing Middleware): gates PREVIEW deployments by default and production opt-in, unlock once via a signed cookie, only a scrypt hash in env, a FULLY BRANDED unlock page (your own HTML/CSS/logo from the middleware — Vercel's password screen has no theming hook), and zero prod cost (the build strips the gate from prod builds). Use when asked to password-protect or basic-auth a preview/staging URL, avoid or cancel that $150/mo add-on, password-protect on Hobby where Vercel won't sell it, brand/white-label a password wall for a client, add a login that "shows once and stays unlocked", set or ROTATE the preview password, add/remove bypass tokens for CI or third-party automation (Lighthouse, uptime checks), protect previews on an app with NO existing middleware, gate a production or pre-launch site with a shared password (coming-soon page, client demo, private internal tool — see "Gating production too"), or decide between a DIY gate and Vercel Authentication (free team SSO).
metadata:
  author: stealth-engine
  co-author: wiiiimm
  version: "1.9.0"
---

# Vercel preview password gate

A free, portable password wall for **preview deployments by default** — and for
**production too, opt-in** (see "Gating production too"). Humans see a brandable
unlock form once (a signed 1-year cookie keeps them in); automation passes with
named bypass tokens via header or query parameter. In the default preview-only
posture, production ships **no middleware function at all** (Mode B) or a
one-boolean short-circuit (Mode A), so the gate's production cost is zero. Only
a **scrypt hash** of the password is stored; unlock cookies are keyed
per-credential, so rotating the password or removing a bypass token revokes
exactly the cookies it issued.

## What this reimplements (and what it doesn't)

This skill is a DIY reimplementation of Vercel's **Advanced Deployment
Protection** add-on — **$150/mo on Pro**, included on Enterprise, and **not sold
on Hobby at any price** — rebuilt in one middleware file so it costs nothing on
any plan. Vercel bundles three features into that add-on: the gate ships the two
that matter for a password wall, and the third is a documented one-line fork.

| Advanced Deployment Protection bundles… | This skill's equivalent |
| --- | --- |
| **Password Protection** — the headline feature | ✅ Unlock form + `PREVIEW_PASSWORD_HASH` (scrypt). Matches the platform's semantics: enter once per deployment URL, and changing the password invalidates the cookies it issued. |
| **Private Production Deployments** (the "All Deployments" scope — password on the production domain too) | ✅ **Fully supported, opt-in** — the gate can protect production as well as previews (coming-soon page, client demo, private internal tool). Preview-only is just the *default*; "Gating production too" is the three-step switch. Trade-off: you give up the zero-prod-cost property, since the middleware then runs in prod. |
| **Deployment Protection Exceptions** — "disable Deployment Protection for a list of **preview domains**" (whole domain goes public) | 🟡 Not shipped as a feature, but it's a **one-line fork**: the exception axis is the request *host*, so early-return from `previewGate` when `request.headers.get("host")` is in an allowlist (e.g. a `PREVIEW_GATE_UNPROTECTED_HOSTS` env var). Note the gate's `matcher` is **not** this — that's path-level (skip `/api`, static assets), a different axis. |

Adjacent Deployment Protection features, for orientation:

| Vercel feature | Plan / price | This skill |
| --- | --- | --- |
| **Protection Bypass for Automation** | All plans, but **one** project-wide secret | ✅ Improved on: `PREVIEW_GATE_BYPASS_TOKENS` gives **many named, individually revocable** tokens; same header / query-param / set-cookie UX. |
| **Shareable Links** | Pro+ | ❌ Not reimplemented. A per-recipient bypass token is the closest analogue (no TTL, no per-alias minting). |
| **Vercel Authentication** (team SSO) | Free, all plans | ❌ **Can't be** — the session lives on vercel.com. See Step 0; prefer it when it fits. |
| **Trusted IPs** / **Passport** | Enterprise | ❌ Out of scope. |

**Where the DIY version is genuinely better:** the unlock page is *yours*. Vercel's
password screen is Vercel-branded and exposes no customisation — the entire
configuration surface across dashboard, API, and Terraform is `deploymentType` +
`password` (verified against Vercel's Password Protection docs, 2026-07-17).
Because this gate renders its own HTML from the middleware, you can match the
client's brand, logo, fonts, and design system — which matters when the wall is
the first thing a client or stakeholder sees. See
"Style the unlock page" below (it's a required install step, not a nicety).

**Where the platform version is genuinely better:** it runs *before* your code
(so it protects static assets and any route, with no middleware to misconfigure),
it can't fail open on a missing env var, and it's Vercel's problem to maintain.
This gate is a **speed bump**, not auth — see the gotcha of the same name.

Release-method agnostic: everything keys off the Vercel environment
(`VERCEL_TARGET_ENV`), never branch names — it composes with any
promotion/branch/deploy model.

## Step 0 — check whether you need this at all

| Need | Right tool |
| --- | --- |
| Only the Vercel team views previews | **Vercel Authentication** (Deployment Protection → Standard). Free on all plans, zero code, team members pass invisibly via their Vercel login. Prefer this when it fits. |
| External stakeholders, team on Pro | Vercel Authentication + **Shareable Links** (Pro). Still zero code. |
| Anyone-with-a-password, for free | **This skill.** Vercel's **Password Protection** is Enterprise-only, or **Pro + $150/mo** for the *Advanced Deployment Protection* add-on (which you must keep ≥30 days before you can cancel). On **Hobby it can't be bought at all** — the DIY gate is the only password option there. Verified against Vercel's docs 2026-07-17; re-check pricing. |
| The password page must carry **your/your client's branding** | **This skill.** Vercel's password screen is Vercel's — `deploymentType` + `password` is its whole config surface, with no theming hook. This gate renders your own HTML. |
| Non-Next framework, static export, or SPA on Vercel | **Still this skill** — use the framework-agnostic template via Vercel Routing Middleware (see "Pick your template"), which runs platform-level before the app or static assets. |

A DIY gate **cannot** detect "is this visitor logged into Vercel" — that session
lives on vercel.com and is only checkable by platform-level Vercel Authentication,
which runs *before* your code. Don't try to hybridize; pick per the table.

### Already on Vercel Authentication, need limited third-party access?

The DIY gate can't help here (the platform wall blocks third parties before your
code runs). Use the platform's own bypass methods instead:

1. **Shareable Links** (plan-gated, Pro+ last verified 2026-07) — the purpose-built
   answer. Minted per deployment URL/alias with optional TTL, individually
   revocable, no shared secret. Create from the deployment's **Share** dialog in
   the dashboard, or via API (`PATCH /aliases/{id}/protection-bypass`, `ttl`).
2. **Protection Bypass for Automation** (all plans) — a project-wide secret in a
   crafted URL: `https://<preview-url>/?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`
   persists a bypass cookie. Trade-offs: ONE secret per project, and secrets in
   URLs end up in logs — the fallback when Shareable Links aren't on the plan.

## Pick your template

Two templates, identical behavior, env vars, and helper scripts — pick by framework:

| Project | Template | Installs as |
| --- | --- | --- |
| **Next.js** | [`templates/preview-gate.ts`](./templates/preview-gate.ts) — no deps beyond `next/server` + `node:crypto` | `proxy.ts` (Mode B) or `lib/preview-gate.ts` (Mode A) |
| **Anything else on Vercel** (SvelteKit, Nuxt, Astro, Remix, static/SPA) | [`templates/preview-gate.vercel.ts`](./templates/preview-gate.vercel.ts) — uses Vercel Routing Middleware; one dep (`@vercel/functions`); `config.runtime` must stay `"nodejs"` (edge is the default and lacks `node:crypto`) | root `middleware.ts`, next to `package.json` |

The skill's mechanics (`VERCEL_TARGET_ENV` gating, env-var management via
`vercel env`, build-time strip) are Vercel-platform-wide, not framework-specific.

## How the gate works (both modes)

Single self-contained file:

- Gates every **remote non-production** Vercel deployment — `preview` **and any
  custom environment** (e.g. a named "staging"). The signal is
  **`VERCEL_TARGET_ENV`** (falling back to `VERCEL_ENV` when absent), NOT
  `VERCEL_ENV`: `VERCEL_ENV` only ever reports `production`/`preview`/`development`
  and collapses every custom environment into one of those buckets, so a custom
  target can read `VERCEL_ENV=production` and slip through **ungated**.
  `VERCEL_TARGET_ENV` carries the custom name. It **fails open** only when that
  value is `production`, `development`, or unset (local / non-Vercel).
- No valid cookie → responds `401` with an inline HTML password form (no extra
  routes/pages added to the app). Form POSTs to `/__preview-unlock`.
- **Human auth:** `PREVIEW_PASSWORD_HASH` stores `s2:<salt>:<scryptHex>` (scrypt, memory-hard)
  — **never the plaintext**. Submitted passwords are run through scrypt and compared
  constant-time. (Legacy fallback: a plaintext `PREVIEW_PASSWORD` also works.)
- **Automation auth (mimics Vercel's Protection Bypass for Automation):**
  `PREVIEW_GATE_BYPASS_TOKENS` stores JSON `{"<label>":"<token>", ...}` —
  plaintext **by design** (automation must read tokens back; they're generated
  random, never human-reused). Send a token via the `x-preview-gate-bypass`
  **header** (passes through + sets the cookie) or **query parameter** (303
  redirect to the cleaned URL — token stripped from the address bar — with the
  cookie set, so one crafted link = click-once access for a service that can't
  set headers). Bypass accepts **tokens only** — the human password never
  works in the header or query param: verifying a password costs a memory-hard
  scrypt run, so accepting it per-request would hand attackers a CPU-DoS
  amplifier (and passwords don't belong in URLs). The password unlocks solely
  via the form.
- Unlock cookies are HMACs **keyed on the credential that minted them**:
  rotating the password kills password-issued cookies; removing a bypass token
  kills that token's cookies. `maxAge` 1 year → "unlocks once, stays unlocked".
- **Absent config fails open** (a fresh clone never bricks its previews);
  **present-but-malformed `PREVIEW_PASSWORD_HASH` fails CLOSED** (503) — a
  typo must not silently publish a preview the operator meant to protect. A
  legacy `PREVIEW_PASSWORD` longer than the 256-char cap also fails closed
  (it would hash into a config the unlock form's length cap can never match —
  gated with no way in), and the 503 body names both causes. Malformed
  bypass-token JSON is ignored with a warning (password still works).

**Why a cookie, not localStorage:** the decision happens server-side in the
proxy before any JavaScript runs; the token must travel with the request.
localStorage physically cannot gate SSR. Same "enter once" UX.

## Mode A — app already has `middleware.ts` / `proxy.ts`

The middleware function already runs on every matched request, so the gate adds
one env-var boolean in production — no new invocations, no meaningful cost.

> ⚠️ **If the host file is legacy `middleware.ts`, migrate it to `proxy.ts`
> first** (`npx @next/codemod@latest middleware-to-proxy .`, or rename the file
> + the exported function and fix test imports). `middleware.ts` runs on the
> **Edge runtime even in Next 16**, where `node:crypto` does not exist — the
> gate 500s every request. Caught in a real install (piaf-web, Next 16.2.7,
> 2026-07-17): `Error: Failed to load external module node:crypto`.

1. Copy [`templates/preview-gate.ts`](./templates/preview-gate.ts) to
   `lib/preview-gate.ts`.
2. Wire it into the existing `proxy()` / `middleware()` function — check first,
   attach the cookie to whatever response the pipeline produces last:

   ```ts
   import { previewGate, withUnlockCookie } from "./lib/preview-gate";

   export async function proxy(request: NextRequest) {
     const gate = await previewGate(request);
     if (gate.block) return gate.block;

     const response = await yourExistingLogic(request);
     return gate.setCookie ? withUnlockCookie(response, gate.setCookie) : response;
   }
   ```

   The `setCookie` path matters: a header-bypassed request must CONTINUE
   through the host pipeline (i18n redirects, rewrites, analytics cookies) —
   returning a bare pass-through from the gate would skip all of it (caught by
   review on the piaf-web install).

3. Check the host matcher: it must not exclude `/__preview-unlock`, and if it
   excludes `/api` (piaf-web's did), decide deliberately — un-gated API routes
   on previews are usually a hole. Include `/api` in the matcher and skip only
   the host's page-routing logic for API paths.
4. Do **NOT** wire up the removal script — the host middleware must ship to
   production for its own duties.

## Mode B — app has NO middleware (strict zero prod cost)

The gate file is the app's real, checked-in `proxy.ts`; a build step strips it
from production builds only:

1. Copy [`templates/preview-gate.ts`](./templates/preview-gate.ts) to the app
   root as `proxy.ts` (checked in — it IS the middleware; lintable, typecheckable).
2. Copy [`templates/remove-proxy-on-prod.mjs`](./templates/remove-proxy-on-prod.mjs)
   to `scripts/remove-proxy-on-prod.mjs`.
3. Chain it into the build (explicit chaining, **not** an npm `prebuild` hook —
   pnpm skips pre/post scripts by default):

   ```jsonc
   // package.json
   "build": "node scripts/remove-proxy-on-prod.mjs && next build"
   ```

Non-Next frameworks: same steps, but the checked-in file is the root
`middleware.ts` (the framework-agnostic template) and the removal script's
`targetPath` constant points at it; chain the script before the framework's
own build command.

Lifecycle:

| Context | What happens |
| --- | --- |
| Local `next dev` / `next build`, non-Vercel hosts, `VERCEL_TARGET_ENV=development` | File runs, gate no-ops. Test the gate locally with `VERCEL_TARGET_ENV=preview PREVIEW_PASSWORD=test next dev`. |
| Vercel **preview** OR any **custom environment** (e.g. `staging`) build | File ships, gate active (keyed on `VERCEL_TARGET_ENV`). The build-strip only fires on true `production` (`VERCEL_TARGET_ENV`), so custom-env builds keep the proxy. |
| Vercel **production** build | Script deletes `proxy.ts` before `next build` → the deployment provisions **no middleware function** → zero invocations, zero cost, structurally. |

Safety guards in the removal script: it only deletes a file carrying the
`@preview-gate:managed` marker (never hand-written middleware — if the marker is
missing it warns and leaves the file), and it only acts inside a real Vercel
TRUE-production build (`VERCEL=1` plus `VERCEL_TARGET_ENV` — falling back to
`VERCEL_ENV` — equal to `production`), so local builds never mutate the
working tree and custom-environment builds keep the gate. The file is git-tracked anyway; `git checkout -- proxy.ts`
restores it if anything ever goes sideways.

## Gating production too (deliberate deviation)

By default this gate is **preview-only** — production always passes through, and
in Mode B the proxy is stripped from production builds entirely. Sometimes a user
genuinely wants a password wall on production: a **pre-launch "coming soon"
site**, a **client demo on the real domain**, or a **private internal tool**.
This skill can do that, but treat it as a fork, not a toggle — and start by
asking *why*, because the answer decides whether this is even the right tool.

**First, the guardrail — is this the right tool?** This gate is a *shared-password
speed bump*: one password, no per-user identity, no rate limiting (see the
"speed bump, not auth" gotcha). It is fine for a teaser page, a demo, or a
low-stakes internal tool. It is **NOT** access control for real user data,
accounts, payments, or anything you'd be embarrassed to see breached — for that,
steer the user to **Vercel Authentication**, **Clerk**, or a real IdP instead.
If they insist on this for a high-stakes surface, say plainly that it's a speed
bump, not a lock.

**If it's a legitimate low-stakes case, make these three changes together:**

1. **Predicate — also gate production.** In `previewGate`, drop the
   `production` arm from the pass-through condition. Keep the same
   `VERCEL_TARGET_ENV ?? VERCEL_ENV` resolution as the stock predicate (testing
   `VERCEL_ENV` alone re-opens the custom-environment hole), and keep
   `development` and unset failing open so local dev and non-Vercel hosts stay
   ungated:

   ```ts
   // gate production too — only local dev / non-Vercel fall through
   const target = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV;
   if (target === undefined || target === "development") return {}; // or { action: "pass" }
   ```

2. **Mode B ONLY — do NOT wire `remove-proxy-on-prod.mjs`.** ⚠️ This is the
   footgun. That script *deletes the gate from production builds* (the whole
   zero-cost trick). If you gate production but leave the removal script in the
   build chain, the proxy vanishes in prod and **the site is wide open with no
   warning**. Remove the `node scripts/remove-proxy-on-prod.mjs &&` from the
   build command. (Mode A has no removal script, so nothing to undo there.)

3. **Env vars — add the Production scope.** The password hash and any bypass
   tokens are Preview-scoped by default; add them to **Production** too, e.g.
   `… | vercel env add PREVIEW_PASSWORD_HASH production`. Without this the
   production gate has no configured password and **fails open** (absent config
   is intentionally fail-open so a fresh clone isn't bricked).

**Consequence to state to the user:** the "zero production cost" property is
gone — the middleware now runs on every production request (one env check +,
when locked, the response). That's the price of gating production; it's small,
but it's no longer free.

## Style the unlock page (required when installing)

The form in `unlockFormHtml()` is a deliberately neutral baseline. Styling it is
**the payoff for doing this yourself** — Vercel's paid Password Protection shows
Vercel's own screen with no theming hook, so a branded wall is something the
add-on cannot buy. It's also often the first thing a client or stakeholder sees.

When installing the gate into a real project, **restyle it professionally to match
the project's existing look and feel** — check for a design system, brand
tokens, fonts, logo, and how existing auth/error pages are styled, and mirror
them. If the project has no design language, keep it minimal and clean rather
than inventing one. Requirements:

- **Responsive and mobile-first**: fluid layout (no fixed widths), works from
  ~320px up, `min-height: 100dvh` centering, comfortable touch targets
  (≥44px), and ≥16px input font-size (prevents iOS auto-zoom on focus).
- **Self-contained or same-origin only**: inline all CSS; a logo may be inlined
  as a data URI or referenced same-origin (the matcher lets static assets
  through) — never load from external hosts.
- Support light AND dark (`color-scheme` + `prefers-color-scheme`).
- **Preserve the functional invariants**: `method="post"`, the computed
  `action` (UNLOCK_PATH + encoded `from`), `name="password"`, the failed-state
  error message, `<meta name="robots" content="noindex">`, `autofocus`,
  `autocomplete="current-password"`, and `escapeHtml()` on anything
  interpolated. Style everything else freely.

## Set or rotate the password (agent workflow)

Same flow for first-time setup and rotation — only the hash is ever stored:

1. **Get the plaintext from the user** (ask directly, or offer to generate one:
   `openssl rand -base64 12`, show it to the user ONCE). Never write the
   plaintext to any file, env file, commit, or log.
2. **Hash it** with the bundled script (matches the gate's scheme, random salt
   each run):

   ```bash
   node <skill-dir>/templates/hash-password.mjs '<plaintext>'
   # → s2:<salt>:<scryptHex>
   ```

3. **Store the hash, scoped to Preview only.** Rotation = remove then re-add:

   ```bash
   vercel env rm PREVIEW_PASSWORD_HASH preview -y   # skip on first setup
   node <skill-dir>/templates/hash-password.mjs '<plaintext>' | vercel env add PREVIEW_PASSWORD_HASH preview
   ```

   Project uses **custom environments** (e.g. `staging`)? Repeat for each one
   (`… | vercel env add PREVIEW_PASSWORD_HASH staging`) — custom environments
   have their own env-var scope on Vercel and do NOT inherit Preview vars, yet
   the gate DOES activate there; leave the var unset and that environment has
   absent config → **fails open, silently ungated**.

4. **Tell the user the rotation semantics:**
   - New deployments use the new hash immediately; all previously issued
     password cookies stop working on them (cookie is keyed on the hash).
   - **Already-deployed previews keep honoring the old password until each is
     redeployed** — Vercel env changes apply to new builds only. Redeploy the
     stable staging alias if immediate revocation matters.
   - A leaked env var exposes only a scrypt hash (memory-hard to brute-force) — acceptable for a speed
     bump, but tell users not to reuse a real password.

## Manage automation bypass tokens (agent workflow)

Named, individually revocable machine credentials, stored as JSON in
`PREVIEW_GATE_BYPASS_TOKENS` (Preview scope — plus each custom environment,
which has its own env-var scope; same caveat as the password hash). Use
[`templates/bypass-tokens.mjs`](./templates/bypass-tokens.mjs) — it's pure
(JSON in → JSON out on stdout, human summary + generated token on stderr), the
agent glues it to `vercel env`:

1. **Read the current value** (skip on first setup):

   ```bash
   vercel env pull --environment=preview /tmp/preview.env
   grep '^PREVIEW_GATE_BYPASS_TOKENS=' /tmp/preview.env   # → current JSON
   rm /tmp/preview.env                                     # don't leave it around
   ```

2. **Add / remove / list** (label examples: `ci`, `lighthouse`, `uptime`):

   ```bash
   node <skill-dir>/templates/bypass-tokens.mjs add ci '<current-json-or-empty>'
   node <skill-dir>/templates/bypass-tokens.mjs remove lighthouse '<current-json>'
   node <skill-dir>/templates/bypass-tokens.mjs list '<current-json>'
   ```

   `add` generates a URL-safe (base64url) token and refuses duplicate labels —
   rotate by `remove` + `add`. Show the generated token to the user once.

3. **Write back** (remove + re-add, like the password):

   ```bash
   vercel env rm PREVIEW_GATE_BYPASS_TOKENS preview -y   # skip on first setup
   node <skill-dir>/templates/bypass-tokens.mjs add ci '<current>' | vercel env add PREVIEW_GATE_BYPASS_TOKENS preview
   ```

4. **Usage by automation** (tell the user):
   - Header (CI, Playwright, curl): `x-preview-gate-bypass: <token>`
   - Query param (services that can't set headers; also human click-once
     links): `https://<preview-url>/path?x-preview-gate-bypass=<token>` — the
     gate 303s to the cleaned URL and sets the cookie.
   - Mimic Vercel's `VERCEL_AUTOMATION_BYPASS_SECRET` convention: designate one
     token (e.g. `ci`) and store it as a CI secret named
     `PREVIEW_GATE_BYPASS_SECRET` for workflows to read.
5. **Revocation semantics:** removing a token invalidates its cookies on new
   deployments immediately (cookies are keyed per-token) — but as with the
   password, **already-deployed previews honor the old env until redeployed**.

## Gotchas

- **Custom environments don't inherit Preview env vars.** The gate activates on
  custom environments (`VERCEL_TARGET_ENV=staging`), but `vercel env add …
  preview` doesn't reach them — each custom environment is its own scope. Add
  `PREVIEW_PASSWORD_HASH` (and any bypass tokens) per custom environment, or
  use "Import variables" when creating it; otherwise that environment sees
  absent config and fails open, silently ungated.
- **Cookies are per-origin.** The stable branch alias (`*-git-main-*.vercel.app`)
  unlocks once, permanently — but every PR's unique preview URL prompts once per
  browser. Expected behavior, warn stakeholders.
- **Query-param tokens can land in logs** (server/proxy access logs capture the
  first request even though the gate strips the URL afterward) — same caveat
  Vercel documents for its own bypass query param. Prefer the header where the
  caller supports it; treat leaked tokens as rotate-on-suspicion.
- **Next ≤15 / edge runtime:** Next 16's `proxy.ts` is Node-runtime-only, which
  is what the template assumes (`node:crypto`). On Next ≤15 rename the file to
  `middleware.ts`, the export to `middleware` (and the removal-script target to
  match); if it runs on the edge runtime, replace `node:crypto` with Web Crypto
  (`crypto.subtle.digest`/`sign` + a manual XOR-fold compare) — edge has no
  `node:crypto`.
- **This is a speed bump, not auth.** One shared password + machine tokens, no
  user identity, no rate limiting. Never point it at production traffic or
  guard real user data with it. The expensive scrypt check runs only on
  explicit form POSTs to `/__preview-unlock` (input capped at 256 chars);
  every per-request check — cookie, bypass tokens — is a cheap constant-time
  compare, so the gate itself is not a CPU amplifier.
- **`formData()` in the proxy** consumes the request body — fine here because a
  locked-out visitor's POST never reaches the app anyway.
- **Turbo/monorepo caches:** the removal script mutates the app dir before
  `next build`; make sure `VERCEL_TARGET_ENV` (and its `VERCEL_ENV` fallback)
  participates in the build's cache key — a custom-env build and a true-prod
  build can share `VERCEL_ENV=production` yet differ in whether the proxy
  ships. On Vercel this works via environment separation; for custom Turborepo
  remote caching, add both to the task's `env` list.

Provenance: Next 16 proxy rename + Node-only runtime verified against the
official v16 upgrade guide (2026-07); build-time `VERCEL_ENV`/`VERCEL`
availability and Deployment Protection tiers/bypass methods per Vercel docs,
same date. Removal-script guard behavior and both helper scripts smoke-tested
locally (2026-07-17). Password hashing upgraded from salted SHA-256 to scrypt
after CodeQL flagged `js/insufficient-password-hash` (high) in a real install
(piaf-web PR #122, 2026-07-17). Round-2 review of the same install (Codex +
Greptile) added: /api-inclusive matcher guidance, the block/setCookie contract
(header bypass must not skip the host pipeline), and fail-closed on malformed
config. v1.6.0 hardening pass (2026-07-17): bypass is now tokens-only
(password-as-bypass ran scrypt per request — a CPU-DoS amplifier),
control-character rejection in sanitizeReturnPath (the URL parser strips
tab/CR/LF, so `from=/%09/evil.com` re-formed into a protocol-relative open
redirect), pre-ES2021-safe `escapeHtml` (`replace(/…/g)`, not `replaceAll`),
`$`-anchored static-extension matcher (pages containing ".js" in their name
were skipping the gate), `cache-control: no-store` on Next-variant redirects,
256-char password cap (gate + hash script), and prototype-safe label checks in
bypass-tokens.mjs. Custom-environment fix (2026-07-17, piaf-web PR #124): the
gate activates for every remote non-production `VERCEL_ENV` — `preview` AND any
custom environment — instead of `=== "preview"` only, which silently left
custom environments (e.g. "staging") unprotected; production/development/unset
still fail open, and the Mode-B build-strip still keys only on `production`.
v1.7.0 (2026-07-17): added the "Gating production too" section — the deliberate
three-step deviation (predicate, drop the build-strip, add the Production env
scope) plus the footgun warning and the speed-bump-not-auth guardrail, so other
models handle a "protect production" request without deleting the gate in prod.
v1.8.0 (2026-07-17, piaf-web PR #124 review): the gate keys off
**`VERCEL_TARGET_ENV`** (fallback `VERCEL_ENV`) — Codex correctly flagged that
`VERCEL_ENV` never holds a custom-environment name (only production/preview/
development), so the v1.6/1.7 `VERCEL_ENV` test left custom targets that report
`VERCEL_ENV=production` ungated; the build-strip likewise now keys off
`VERCEL_TARGET_ENV` so it strips only TRUE production. Also backported from the
same review: legacy `PREVIEW_PASSWORD` over the length cap fails closed (Greptile
P1 — otherwise gated with no valid unlock), and the 503 message names both
misconfiguration causes.
v1.8.1 (2026-07-17): consistency pass after v1.8.0 — the "Gating production
too" predicate, the removal-script guard description, and the Turborepo
cache-key gotcha now key off `VERCEL_TARGET_ENV` like the templates (the old
section still showed the `VERCEL_ENV`-era predicate, which would re-open the
custom-environment hole); documented that custom environments have their own
env-var scope (Preview-scoped vars don't reach them — per Vercel's
environments docs — so set the hash/tokens per custom environment or the gate
finds absent config there and fails open); the removal script's keep-log now
prints the resolved target alongside VERCEL_ENV (string only, no behavior
change). `VERCEL_TARGET_ENV` semantics (carries custom-environment names,
available at build time AND runtime) verified against Vercel's system
environment variables reference, 2026-07-17.
v1.9.0 (2026-07-17): framed the skill as what it is — a free reimplementation of
Vercel's **Advanced Deployment Protection** add-on — with a feature-by-feature
parity table, and documented the branded-unlock-page advantage. Facts verified
against Vercel's Deployment Protection and Password Protection docs, 2026-07-17:
the add-on is **$150/mo** for Pro ("you pay $150 per month for the add-on"),
bundles Password Protection + Private Production Deployments + Deployment
Protection Exceptions, is included on Enterprise, requires a **30-day minimum**
before cancelling, and Password Protection is "Available on the Enterprise plan,
or as a paid add-on for Pro plans" — i.e. **not purchasable on Hobby**, where
this gate is the only password option. The no-branding claim is from the
documented config surface: dashboard, REST (`passwordProtection`), and Terraform
expose only `deploymentType` + `password`, with no theming hook — an argument
from absence, so re-check if Vercel ships customisation.
