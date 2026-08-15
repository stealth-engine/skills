---
name: vercel-deployment-password-gate
description: "A free DIY reimplementation of Vercel's $150/mo Advanced Deployment Protection add-on — all three features (Password Protection, private/prod deployments, Deployment Protection Exceptions) plus named automation bypass tokens — a middleware gate for ANY framework on Vercel (Next.js proxy, or SvelteKit/Nuxt/Astro/Remix/static via Routing Middleware). Gates previews by default, production opt-in; fully branded unlock page; zero prod cost. Use when asked to password-protect or basic-auth a preview/staging URL, avoid or cancel that add-on, password-protect on a Hobby plan, brand/white-label a password wall, add a login that \"shows once and stays unlocked\", set or ROTATE the password, add/remove bypass tokens for CI or automation (Lighthouse, uptime), make one preview domain public, protect previews on an app with NO existing middleware, gate a production or pre-launch site with a shared password (coming-soon, client demo, internal tool), or choose between a DIY gate and Vercel Authentication (free team SSO)."
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.11.11"
---

# Vercel deployment password gate

A free, portable password wall for **preview deployments by default** — and for
**production too, opt-in** (see "Gating production too"). Humans see a brandable
unlock form once (a signed 1-year cookie keeps them in); automation passes with
named bypass tokens via header or query parameter. In the default preview-only
posture, production ships **no middleware function at all** (Mode B) or a
one-boolean short-circuit (Mode A), so the gate's production cost is zero. Only
a **scrypt hash** of the password is stored; unlock cookies are keyed
per-credential, so rotating the password or removing a bypass token revokes
exactly the cookies it issued.

## What this reimplements

A free, DIY reimplementation of Vercel's **Advanced Deployment Protection**
add-on — **$150/mo on Pro** (30-day minimum before you can cancel), included on
Enterprise, and apparently **not sold on Hobby at all** — rebuilt in one
middleware file. Vercel bundles three features into the add-on — **all three are
supported here**:

| Advanced Deployment Protection | This skill |
| --- | --- |
| **Password Protection** | ✅ Unlock form + `DEPLOY_GATE_PASSWORD_HASH` (scrypt), mirroring the platform's semantics: enter once per deployment URL, and changing the password invalidates the cookies it issued. One difference: Vercel's change takes effect on existing deployments immediately; ours applies to new builds, so redeploy to revoke now. |
| **Private Production Deployments** (password on the production domain too) | ✅ Opt-in — previews by default, production via "Gating production too". Trade-off: the middleware then runs in prod, so the zero-prod-cost property is gone. |
| **Deployment Protection Exceptions** (unprotect specific **preview domains**) | ✅ `DEPLOY_GATE_UNPROTECTED_HOSTS` — comma-separated hosts that skip the gate and are public. Same axis as Vercel's (the *domain*); the `matcher` is a different thing (path-level: `/api`, static assets). See "Unprotect specific domains". |

Plus an equivalent of **Protection Bypass for Automation**: named, individually
revocable tokens, same header / query-param / set-cookie UX. This is **parity,
not an improvement** — Vercel's own bypass also supports multiple named,
individually revocable secrets ("You can create multiple bypass secrets per
project", docs updated 2026-04-30), and theirs additionally clears Firewall and
bot-protection challenges, which a DIY token cannot. The reason to use ours is
that it works *with* our gate; if you're on platform protection, use theirs.

Not reimplemented: **Shareable Links** (a per-recipient bypass token is the
closest analogue — no TTL), **Trusted IPs**/**Passport** (out of scope), and
**Vercel Authentication**, which *can't* be — that session lives on vercel.com.

**Two things $150/mo can't buy you.** The unlock page is *yours* — Vercel's
password screen is Vercel-branded with no *documented* theming hook (its whole
config surface across dashboard, API, and Terraform is `deploymentType` +
`password`), so matching a client's brand, logo, and design system is only
possible DIY. And on **Hobby**, where the docs indicate the add-on isn't sold,
this is very likely the only password option at all.

**What the platform does better:** it runs *before* your code (protects static
assets and every route, nothing to misconfigure), it can't fail open on a
missing env var, and it's Vercel's problem to maintain. This gate is a **speed
bump**, not auth — see the gotcha of the same name.

Release-method agnostic: everything keys off the Vercel environment
(`VERCEL_TARGET_ENV`), never branch names — it composes with any
promotion/branch/deploy model.

## Step 0 — check whether you need this at all

| Need | Right tool |
| --- | --- |
| Only the Vercel team views previews | **Vercel Authentication** (Deployment Protection → Standard). Free on all plans, zero code, team members pass invisibly via their Vercel login. Prefer this when it fits. |
| External stakeholders | Vercel Authentication + **Shareable Links** (all plans; Hobby is capped at one link per account, Pro+ lifts the cap). Still zero code. |
| Anyone-with-a-password, for free | **This skill.** Vercel's **Password Protection** is Enterprise-only, or **Pro + $150/mo** for the *Advanced Deployment Protection* add-on (which you must keep ≥30 days before you can cancel) — both verified against Vercel's docs 2026-07-17; re-check pricing. On **Hobby it appears unbuyable** (the docs list it as "Enterprise, or a paid add-on for Pro", and say Hobby gets only Vercel Authentication) — *inferred from the plan listings, not stated outright*, so the DIY gate is very likely the only password option there. |
| The password page must carry **your/your client's branding** | **This skill.** Vercel's password screen is Vercel's — `deploymentType` + `password` is its whole documented config surface, with no theming hook. This gate renders your own HTML. |
| Non-Next framework, static export, or SPA on Vercel | **Still this skill** — use the framework-agnostic template via Vercel Routing Middleware (see "Pick your template"), which runs platform-level before the app or static assets. |

A DIY gate **cannot** detect "is this visitor logged into Vercel" — that session
lives on vercel.com and is only checkable by platform-level Vercel Authentication,
which runs *before* your code. Don't try to hybridize; pick per the table.

### Already on Vercel Authentication, need limited third-party access?

The DIY gate can't help here (the platform wall blocks third parties before your
code runs). Use the platform's own bypass methods instead:

1. **Shareable Links** — the purpose-built answer. Minted per deployment
   URL/alias with optional TTL, individually revocable, no shared secret. Create
   from the deployment's **Share** dialog in the dashboard, or via API
   (`PATCH /aliases/{id}/protection-bypass`, `ttl`). Available on **Hobby too**,
   but capped at *one link per account* there; Pro+ lifts the cap (verified
   2026-07-17).
2. **Protection Bypass for Automation** — secrets in a crafted URL:
   `https://<preview-url>/?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`
   persists a bypass cookie. You can create **multiple named secrets per
   project**, each revocable independently (docs updated 2026-04-30), and they
   also clear Firewall/bot-protection challenges. Caveat: secrets in URLs end up
   in logs, so prefer the header where the caller supports it.

## Pick your template

Two templates, identical behavior, env vars, and helper scripts — pick by framework:

| Project | Template | Installs as |
| --- | --- | --- |
| **Next.js** | [`templates/deploy-gate.ts`](./templates/deploy-gate.ts) — no deps beyond `next/server` + `node:crypto` | `proxy.ts` (Mode B) or `lib/deploy-gate.ts` (Mode A) |
| **Anything else on Vercel** (SvelteKit, Nuxt, Astro, Remix, static/SPA) | [`templates/deploy-gate.vercel.ts`](./templates/deploy-gate.vercel.ts) — uses Vercel Routing Middleware; one dep (`@vercel/functions`); `config.runtime` must stay `"nodejs"` (edge is the default and lacks `node:crypto`) | root `middleware.ts`, next to `package.json` |

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
  `VERCEL_TARGET_ENV` carries the custom name. It **fails open** when that value
  is `production` or `development`; when it's **unset**, it fails open only for a
  genuine local dev server (`NODE_ENV === "development"`) **or** when nothing is
  configured — a Vercel deploy with System Env Vars disabled also reads unset but
  runs `NODE_ENV=production`, so a configured one there still gates (see the
  Mode B lifecycle note).
- No valid cookie → responds `401` with an inline HTML password form (no extra
  routes/pages added to the app). Form POSTs to `/__deploy-unlock`.
- **Human auth:** `DEPLOY_GATE_PASSWORD_HASH` stores `s2:<salt>:<scryptHex>` (scrypt, memory-hard)
  — **never the plaintext**. Submitted passwords are run through scrypt and compared
  constant-time. (Legacy fallback: a plaintext `DEPLOY_GATE_PASSWORD` also works.)
- **Automation auth (mimics Vercel's Protection Bypass for Automation):**
  `DEPLOY_GATE_BYPASS_TOKENS` stores JSON `{"<label>":"<token>", ...}` —
  plaintext **by design** (automation must read tokens back; they're generated
  random, never human-reused). Send a token via the `x-deploy-gate-bypass`
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
  **present-but-malformed `DEPLOY_GATE_PASSWORD_HASH` fails CLOSED** (503) — a
  typo must not silently publish a preview the operator meant to protect. A
  legacy `DEPLOY_GATE_PASSWORD` longer than the 256-char cap also fails closed
  (it would hash into a config the unlock form's length cap can never match —
  gated with no way in), and the 503 body names both causes. Malformed
  bypass-token JSON is ignored with a warning (password still works).

**Why a cookie, not localStorage:** the decision happens server-side in the
proxy before any JavaScript runs; the token must travel with the request.
localStorage physically cannot gate SSR. Same "enter once" UX.

### Env-var names (and the legacy aliases)

All config vars use the **`DEPLOY_GATE_`** prefix, because the gate protects
production too — the old `PREVIEW_`-prefixed names implied preview-only and were
misleading once production gating landed:

| Purpose | Current name | Legacy alias (still honoured) |
| --- | --- | --- |
| Password hash | `DEPLOY_GATE_PASSWORD_HASH` | `PREVIEW_PASSWORD_HASH` |
| Plaintext password (legacy scheme) | `DEPLOY_GATE_PASSWORD` | `PREVIEW_PASSWORD` |
| Automation bypass tokens | `DEPLOY_GATE_BYPASS_TOKENS` | `PREVIEW_GATE_BYPASS_TOKENS` |
| Unprotected-host allowlist | `DEPLOY_GATE_UNPROTECTED_HOSTS` | *(new — no alias)* |

The gate reads the current name first and **falls back to the legacy alias with
a one-time warning** if only the old one is set — a rename can't fail open,
because absent config is intentionally fail-open (an existing install that still
has `PREVIEW_PASSWORD_HASH` keeps working; migrate at leisure). The current name
**wins** if both are set. To migrate, add the `DEPLOY_GATE_*` var and remove the
`PREVIEW_*` one; the alias support is a courtesy, not a permanent contract.

## Mode A — app already has `middleware.ts` / `proxy.ts`

The middleware function already runs on every matched request, so the gate adds
one env-var boolean in production — no new invocations, no meaningful cost.

> ⚠️ **If the host file is legacy `middleware.ts`, migrate it to `proxy.ts`
> first** (`npx @next/codemod@canary middleware-to-proxy .` — the tag Next's proxy
docs use for this codemod, or rename the file
> + the exported function and fix test imports). `middleware.ts` runs on the
> **Edge runtime even in Next 16**, where `node:crypto` does not exist — the
> gate 500s every request. Caught in a real install (piaf-web, Next 16.2.7,
> 2026-07-17): `Error: Failed to load external module node:crypto`.

1. Copy [`templates/deploy-gate.ts`](./templates/deploy-gate.ts) **next to your
   host proxy file** and import it *relatively*. If the host proxy is at the
   project root (`proxy.ts`), put the helper at `lib/deploy-gate.ts`; if the
   host uses a `src/` layout (`src/proxy.ts`), put it at `src/lib/deploy-gate.ts`
   — a root `./lib/deploy-gate` import from `src/proxy.ts` resolves to
   `src/lib/…` and won't find a root `lib/`, so the build fails.
2. Wire it into the existing `proxy()` / `middleware()` function — check first,
   attach the cookie to whatever response the pipeline produces last. Pass the
   request protocol so the unlock cookie persists on a local `http://` dev run:

   ```ts
   import { previewGate, withUnlockCookie } from "./lib/deploy-gate";

   export async function proxy(request: NextRequest) {
     const gate = await previewGate(request);
     if (gate.block) return gate.block;

     // Strip the bypass token from the headers forwarded upstream, so your app /
     // request logging never sees it (Mode B's proxy.ts does this for you). Pass
     // THESE cleaned headers into your pipeline — don't reuse the raw `request`.
     const headers = new Headers(request.headers);
     headers.delete("x-deploy-gate-bypass");
     const cleaned = new NextRequest(request.nextUrl, {
       headers,
       method: request.method,
       body: request.body,
       duplex: "half", // required whenever a (stream) body is forwarded, else POSTs throw
     });

     const response = await yourExistingLogic(cleaned);
     const secure = request.nextUrl.protocol === "https:";
     return gate.setCookie ? withUnlockCookie(response, gate.setCookie, secure) : response;
   }
   ```

   (If your host logic doesn't take a request argument — it reads globals or
   `NextResponse.next()`s — set the cleaned headers on the continue-response
   instead: `NextResponse.next({ request: { headers } })`.)

   The `setCookie` path matters: a header-bypassed request must CONTINUE
   through the host pipeline (i18n redirects, rewrites, analytics cookies) —
   returning a bare pass-through from the gate would skip all of it (caught by
   review on the piaf-web install).

3. Check the host matcher: it must not exclude `/__deploy-unlock`, and if it
   excludes `/api` (piaf-web's did), decide deliberately — un-gated API routes
   on previews are usually a hole. Include `/api` in the matcher and skip only
   the host's page-routing logic for API paths.
4. Do **NOT** wire up the removal script — the host middleware must ship to
   production for its own duties.

## Mode B — app has NO middleware (strict zero prod cost)

The gate file is the app's real, checked-in `proxy.ts`; a build step strips it
from production builds only:

1. Copy [`templates/deploy-gate.ts`](./templates/deploy-gate.ts) to `proxy.ts`
   **at the same level as your `app`/`pages` directory** — the project root, or
   **`src/proxy.ts` if the app uses a `src/` directory**. ⚠️ Next only loads the
   proxy at that level: a root `proxy.ts` in a `src/`-layout app is **silently
   ignored**, and every preview then deploys **ungated even with the password
   set** — the worst failure mode, because nothing errors. (It's checked in — it
   IS the middleware; lintable, typecheckable.) **If the app customises
   `pageExtensions`** (e.g. `.page.ts`), Next expects the proxy named to match —
   `proxy.page.ts` — per Next's proxy docs; a plain `proxy.ts` is ignored (same
   silent-ungate). Name the file accordingly and point the removal script's
   `CANDIDATES` at it.
2. Copy [`templates/remove-proxy-on-prod.mjs`](./templates/remove-proxy-on-prod.mjs)
   to `scripts/remove-proxy-on-prod.mjs`. It scans the common install paths
   (`proxy.ts`, `src/proxy.ts`, `middleware.ts`, `src/middleware.ts`) for the
   managed marker, so a `src/` layout needs no edit; if the gate lives somewhere
   else, add that path to its `CANDIDATES` array.
3. Chain it into the build (explicit chaining, **not** an npm `prebuild` hook —
   pnpm skips pre/post scripts by default):

   ```jsonc
   // package.json
   "build": "node scripts/remove-proxy-on-prod.mjs && next build"
   ```
4. **Verify after the first preview deploy** — this catches the silent-ungate
   class above in one command:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<your-preview-url>/
   # expect 401 (gated). 200 means the proxy isn't running — check its location.
   ```

Non-Next frameworks: same steps, but the checked-in file is `middleware.ts`
**at the project root only** (next to `package.json`) from the framework-agnostic
template. Unlike Next's `proxy.ts`, Vercel Routing Middleware is **only** loaded
from the repo root — a `src/middleware.ts` copy is silently ignored and the
preview deploys ungated, so do NOT put it under `src/` even in a src-layout app
(the `src/*` guidance above is Next-only). The removal script still scans the
`src/` paths defensively, but don't rely on that. Chain the script before the
framework's own build command.

Lifecycle:

| Context | What happens |
| --- | --- |
| Local `next dev` / a Vite dev server (`NODE_ENV=development`), `vercel dev` (`VERCEL_ENV=development`), non-Vercel hosts | Gate no-ops — a dev server is detected by `NODE_ENV=development` (or a `development` Vercel target), so it stays ungated **even if you've pulled preview creds into `.env.local`**. Test the gate locally by forcing a preview target: `VERCEL_TARGET_ENV=preview DEPLOY_GATE_PASSWORD=test next dev`. |
| Vercel **preview** OR any **custom environment** (e.g. `staging`) build | File ships, gate active (keyed on `VERCEL_TARGET_ENV`). The build-strip only fires on true `production` (`VERCEL_TARGET_ENV`), so custom-env builds keep the proxy. |
| Vercel **production** build | Script deletes the gate file before `next build` → the deployment provisions **no middleware function** → zero invocations, zero cost, structurally. |

> **How local vs. preview is told apart (and why the System-Env toggle matters).**
> The gate passes on a `production`/`development` Vercel target, and on a local
> dev server — detected by `NODE_ENV === "development"` (which `next dev` and
> Vite set, and which a Vercel deployment never has at runtime). It gates every
> remote target otherwise. The one ambiguous case is a Vercel **preview with
> "System Environment Variables" disabled** (Vercel → Settings → Environment
> Variables — normally on): with the toggle off, no `VERCEL_*` var reaches the
> runtime, so the target reads `undefined` — but `NODE_ENV` is `production`
> there (it isn't one of the toggle-gated `VERCEL_*` vars), so the gate can tell
> it apart from local dev and **still gates it**. It fails safe either way. Two
> costs of leaving the toggle off: (1) the build-strip needs `VERCEL=1`, so it
> goes inert and production ships the (no-op) middleware — you lose the zero-cost
> property; and (2) **`DEPLOY_GATE_UNPROTECTED_HOSTS` stops working** — host
> exceptions are only honored when the target is a known Vercel env (Host is
> spoofable otherwise), so with the toggle off a domain you marked public stays
> gated. **Recommend enabling it** — required if you use host exceptions.

Safety guards in the removal script: it only deletes a file carrying the
`@deploy-gate:managed` marker (never hand-written middleware — if no marked file
is found it **warns loudly** and leaves everything, since a silent skip would
read as "stripped OK"), and it only acts inside a real Vercel TRUE-production
build (`VERCEL=1` plus `VERCEL_TARGET_ENV` — falling back to `VERCEL_ENV` —
equal to `production`), so local builds never mutate the working tree and
custom-environment builds keep the gate. The file is git-tracked anyway;
`git checkout -- proxy.ts` restores it if anything ever goes sideways.

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
   `production` arm from the pass-through condition, but **keep the stock
   local-dev guard exactly** — do NOT pass on a bare `target === undefined`.
   A real Vercel deployment with System Environment Variables disabled also
   reports `undefined`, so passing on it would leave your production site
   public. Only a genuine local dev server (`NODE_ENV === "development"`) or a
   fully-unconfigured deployment should fall through:

   ```ts
   const target = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV;
   // gate production too — pass ONLY for the local dev server; `undefined`
   // alone is NOT safe (a System-Env-disabled Vercel deploy reads undefined).
   if (target === "development") return {}; // or { action: "pass" }
   if (target === undefined && process.env.NODE_ENV === "development") return {};
   // …then fall through to the stock config/credentials checks, which fail open
   // only when nothing is configured.
   ```

2. **Mode B ONLY — do NOT wire `remove-proxy-on-prod.mjs`.** ⚠️ This is the
   footgun. That script *deletes the gate from production builds* (the whole
   zero-cost trick). If you gate production but leave the removal script in the
   build chain, the proxy vanishes in prod and **the site is wide open with no
   warning**. Remove the `node scripts/remove-proxy-on-prod.mjs &&` from the
   build command. (Mode A has no removal script, so nothing to undo there.)

3. **Env vars — add the Production scope.** The password hash and any bypass
   tokens are Preview-scoped by default; add them to **Production** too, e.g.
   `… | vercel env add DEPLOY_GATE_PASSWORD_HASH production`. Without this the
   production gate has no configured password and **fails open** (absent config
   is intentionally fail-open so a fresh clone isn't bricked).

**Consequence to state to the user:** the "zero production cost" property is
gone — the middleware now runs on every production request (one env check +,
when locked, the response). That's the price of gating production; it's small,
but it's no longer free.

## Style the unlock page (required when installing)

The form in `unlockFormHtml()` is a deliberately neutral baseline. Styling it is
**the payoff for doing this yourself** — Vercel's paid Password Protection shows
Vercel's own screen with no documented theming hook, so a branded wall is
something the add-on cannot buy. It's also often the first thing a client or stakeholder sees.

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
   plaintext to any file, env file, commit, or log — **shell history counts**,
   which is why the commands below never put it on a command line.
2. **Hash it** with the bundled script (matches the gate's scheme, random salt
   each run). Run it with **no argument** so it prompts on stdin:

   ```bash
   node <skill-dir>/templates/hash-password.mjs
   # Deploy-gate password: ‹typed, not echoed to history›
   # → s2:<salt>:<scryptHex>
   ```

   The script also accepts `hash-password.mjs '<plaintext>'`, but that lands the
   password in shell history and in `ps` output — use it only for a throwaway
   local test, never for a real password.

3. **Store the hash, scoped to Preview only.** Only the hash leaves the machine:

   ```bash
   # first setup:
   node <skill-dir>/templates/hash-password.mjs | vercel env add DEPLOY_GATE_PASSWORD_HASH preview
   # rotation — in-place, no gap:
   node <skill-dir>/templates/hash-password.mjs | vercel env update DEPLOY_GATE_PASSWORD_HASH preview
   ```

   Use `vercel env update` to rotate, **not** `rm` then `add`: between an `rm`
   and the next build the var is absent, and absent config **fails open** — a
   deployment built in that window ships ungated. The prompt writes to stderr
   and the hash to stdout, so the pipe carries only the hash. Pasting the `s2:…`
   string into the Vercel dashboard is equivalent — the CLI is convenience, not
   a requirement. (The hash is fine stored **sensitive**, Vercel's default —
   rotation mints a fresh hash and never needs to read the old one back.)

   Project uses **custom environments** (e.g. `staging`)? Repeat for each one
   (`… | vercel env add DEPLOY_GATE_PASSWORD_HASH staging`) — custom environments
   have their own env-var scope on Vercel and do NOT inherit Preview vars, yet
   the gate DOES activate there; leave the var unset and that environment has
   absent config → **fails open, silently ungated**.

4. **Tell the user the rotation semantics:**
   - New deployments use the new hash immediately; all previously issued
     password cookies stop working on them (cookie is keyed on the hash).
   - **Already-deployed previews keep honoring the old password until each is
     redeployed** — Vercel env changes apply to new builds only. Redeploy the
     stable staging alias if immediate revocation matters.
   - **The stored hash is itself a bearer secret — treat a leak like a leaked
     password.** The unlock cookie is `HMAC(key = the hash, "deploy-gate:unlocked:v1")`,
     a fixed public message, so anyone who obtains `DEPLOY_GATE_PASSWORD_HASH`
     (a copied dashboard value, a CI log) can forge a valid cookie **without**
     ever recovering the plaintext — scrypt's memory-hardness only protects the
     *plaintext*, not access. So keep the hash out of logs, and **rotate it** on
     any suspected disclosure, not just a plaintext leak. (Fine for a speed bump;
     just don't reuse a real password, and don't treat the hash as safe to
     expose.)

## Manage automation bypass tokens (agent workflow)

Named, individually revocable machine credentials, stored as JSON in
`DEPLOY_GATE_BYPASS_TOKENS` (Preview scope — plus each custom environment,
which has its own env-var scope; same caveat as the password hash). Use
[`templates/bypass-tokens.mjs`](./templates/bypass-tokens.mjs) — it's pure
(JSON in → JSON out on stdout, human summary + generated token on stderr), the
agent glues it to `vercel env`:

> ⚠️ **Store this var `--no-sensitive` — the workflow depends on reading it
> back.** `vercel env add` defaults to **sensitive** for Preview (and the
> "make it sensitive?" prompt is *skipped* when the value arrives via a pipe, as
> it does here — so the default applies silently), and sensitive values **can't
> be pulled or listed afterward**. Add/remove edits the *existing* token map, so
> a map stored sensitive is unrecoverable: the next edit rebuilds from `{}` and
> **revokes every other token**. Always pass `--no-sensitive` (the tokens are
> plaintext by design anyway). If a team policy *enforces* sensitive, keep the
> token map's source of truth outside Vercel (a secrets manager), or accept
> rotate-all semantics. A map already stored sensitive can't be salvaged —
> regenerate all tokens from `{}` and re-point the automation.

1. **Read the current value** (skip on first setup):

   ```bash
   vercel env pull --environment=preview /tmp/dg.env
   grep '^DEPLOY_GATE_BYPASS_TOKENS=' /tmp/dg.env   # KEY="json" — strip the quotes to get raw JSON
   rm /tmp/dg.env                                    # don't leave it around
   ```

2. **Edit, capturing the new map in ONE run** (label examples: `ci`,
   `lighthouse`, `uptime`). Run the helper exactly once and keep its stdout —
   `add` mints a fresh random token *per invocation*, so running it twice stores
   a different token than the one you showed the user:

   ```bash
   NEW="$(node <skill-dir>/templates/bypass-tokens.mjs add ci '<current-json-or-empty>')"
   # or:  NEW="$(node <skill-dir>/templates/bypass-tokens.mjs remove lighthouse '<current-json>')"
   node <skill-dir>/templates/bypass-tokens.mjs list '<current-json>'   # read-only, no write-back
   ```

   `add` writes the new map to stdout and the generated token + summary to
   stderr; show that token to the user once. It refuses duplicate labels —
   rotate by `remove` + `add`.

3. **Write back the `$NEW` map you captured in step 2** — pipe that exact JSON,
   don't re-run the helper (a second `add` would mint a different token):

   ```bash
   # first setup:
   printf '%s' "$NEW" | vercel env add    DEPLOY_GATE_BYPASS_TOKENS preview --no-sensitive
   # thereafter (in-place, no fail-open gap):
   printf '%s' "$NEW" | vercel env update DEPLOY_GATE_BYPASS_TOKENS preview --no-sensitive
   ```

   `--no-sensitive` is required so step 1 can read the map back next time (see
   the warning above). `update` avoids the `rm`→`add` window where the var is
   absent and the gate fails open.

4. **Usage by automation** (tell the user):
   - Header (CI, Playwright, curl): `x-deploy-gate-bypass: <token>`
   - Query param (services that can't set headers; also human click-once
     links): `https://<preview-url>/path?x-deploy-gate-bypass=<token>` — the
     gate 303s to the cleaned URL and sets the cookie.
   - Mimic Vercel's `VERCEL_AUTOMATION_BYPASS_SECRET` convention: designate one
     token (e.g. `ci`) and store it as a CI secret named
     `DEPLOY_GATE_BYPASS_SECRET` for workflows to read.
5. **Revocation semantics:** removing a token invalidates its cookies on new
   deployments immediately (cookies are keyed per-token) — but as with the
   password, **already-deployed previews honor the old env until redeployed**.
   Removing the **last** token on a token-only deployment (no password hash)
   leaves the var as `{}`, which now **fails closed** (503) rather than
   publishing — to make such a deployment public, *unset* the var entirely
   (`vercel env rm DEPLOY_GATE_BYPASS_TOKENS preview --yes`), don't empty it.

## Unprotect specific domains (Deployment Protection Exceptions)

The equivalent of Vercel's **Deployment Protection Exceptions**: list hosts that
skip the gate entirely. Use it when one preview domain must be public — a
stable demo URL for a client, a webhook receiver, a domain an external service
crawls — while every other preview stays locked.

```bash
# comma-separated; exact hosts, not patterns. --no-sensitive so you can read
# the list back to append to it later (it isn't a secret — it's public hosts).
printf 'demo.acme.com, hooks-preview.acme.com' \
  | vercel env add DEPLOY_GATE_UNPROTECTED_HOSTS preview --no-sensitive
# to append later: pull + edit the list, then `vercel env update … --no-sensitive`
```

Semantics, matching Vercel's feature (and its dashboard's deliberate friction —
it makes you type "unprotect my domain" for a reason):

- **A listed host is fully public.** Not "password optional" — no wall at all.
  Anything reachable on that host is world-readable. Confirm the host with the
  user before adding it, and say plainly what goes public.
- **Exact host match**, case-insensitive, port-stripped. **Not** a suffix or
  wildcard match — listing `acme.com` does *not* unprotect `demo.acme.com`. This
  is deliberate: a suffix match would unprotect every subdomain from one typo.
  List each host explicitly.
- **Checked before the config check**, so an exception still holds if
  `DEPLOY_GATE_PASSWORD_HASH` is malformed — otherwise the fail-closed 503 would
  take down a domain the operator explicitly marked public.
- **Bare hostnames only** — `demo.acme.com`, not `https://demo.acme.com/` and
  not an IP literal. A malformed entry is **ignored with a warning** and that
  domain stays gated (check build/function logs if an exception seems inert).
- **Removing a host re-protects only NEW builds.** Vercel's dashboard version
  re-protects existing deployments immediately; this one is an env var, so every
  already-deployed preview on that host **stays public until redeployed** — same
  lag as password rotation. Redeploy if it matters.
- **Unset (the default) = nothing is excepted**, so existing installs are
  unaffected.
- **Vercel-only, and needs "System Environment Variables" ON.** The check trusts
  the `Host` header, which is safe here *because Vercel's edge routes on that same
  value* — you can't forge it into reaching a deployment you weren't routed to.
  That's a property of Vercel's routing, not of the attacker. So the gate honors
  exceptions **only when it can confirm it's on Vercel** (a known
  `VERCEL_TARGET_ENV`/`VERCEL_ENV`). With the **System-Env-Vars toggle off** those
  vars are absent, so exceptions are silently **not** honored and the host stays
  gated — enable the toggle if you use this var. Self-hosted or behind a proxy
  that routes on the absolute-form target or TLS SNI while forwarding the client's
  `Host`, `Host` is spoofable — don't use this var off Vercel.
- Scope it like the other vars: Preview, plus each custom environment.
- Vercel's version is preview-domains-only. This one keys off the request host,
  so if you've opted into gating production it will except a production host
  too — which is exactly the "public marketing page, gated app" split, but make
  sure that's what you meant.

## Gotchas

- **Static assets are public — matters for SPAs / static sites.** The `matcher`
  excludes real static-asset requests (`.js`, `.css`, images, fonts, source
  maps) so they never run the gate. For an **SSR app** that's fine — those are
  framework code. But a **static export or SPA often bakes its content or data
  into the hashed JS bundle**, and with the default matcher anyone who learns an
  asset URL can fetch that material **without the password** — the gate only
  protects the HTML shell. If your bundles carry anything sensitive, **gate
  everything**: set the matcher to `"/((?!favicon\\.ico$).*)"` (only the tab icon
  stays public) and inline the unlock page's logo as a data URI (a same-origin
  logo would otherwise be gated). It costs one cheap cookie-compare per asset
  request (scrypt runs only on the unlock POST), and in Mode B production still
  ships no middleware at all. This is the "speed bump, not auth" line in
  practice — decide per app.
- **Custom environments don't inherit Preview env vars.** The gate activates on
  custom environments (`VERCEL_TARGET_ENV=staging`), but `vercel env add …
  preview` doesn't reach them — each custom environment is its own scope. Add
  `DEPLOY_GATE_PASSWORD_HASH` (and any bypass tokens) per custom environment, or
  use "Import variables" when creating it; otherwise that environment sees
  absent config and fails open, silently ungated.
- **Cookies are per-origin.** The stable branch alias (`*-git-main-*.vercel.app`)
  unlocks once, permanently — but every PR's unique preview URL prompts once per
  browser. Expected behavior, warn stakeholders.
- **Upgrading from an older install re-prompts once.** The cookie name changed
  (`preview_gate` → `deploy_gate`) and the unlock HMAC context changed with it,
  so anyone currently unlocked will see the form one more time after you deploy
  this version. Harmless, one-time. (The bypass header also changed:
  `x-preview-gate-bypass` → `x-deploy-gate-bypass` — update any automation that
  sends it. The old header is not accepted.)
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
  user identity, no rate limiting. Never use it as access control for real user
  data, accounts, or payments. Gating **production** is supported (see "Gating
  production too") but only for low-stakes surfaces — a coming-soon page, a
  client demo, an internal tool. If the thing behind the wall would be a breach,
  use Vercel Authentication, Clerk, or a real IdP. The expensive scrypt check runs only on
  explicit form POSTs to `/__deploy-unlock` (input capped at 256 chars);
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

Provenance & changelog: how every non-obvious claim was verified, and the full version history, live in [`reference/changelog.md`](./reference/changelog.md). In brief — Vercel pricing/plan/behavior and Next.js proxy placement are verified against the official docs (2026-07-17); the gate's decision logic, env-var fallback, host-matching, and the removal script are smoke-tested with runnable harnesses; and the security-sensitive changes (scrypt hashing, tokens-only bypass, the two fail-open fixes) each trace to a specific review finding recorded there.
