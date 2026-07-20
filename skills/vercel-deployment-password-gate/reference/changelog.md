# Changelog & provenance — vercel-deployment-password-gate

Detailed version history and how non-obvious claims were verified. The current behavior lives in [SKILL.md](../SKILL.md); this file is the audit trail.

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
same review: legacy `DEPLOY_GATE_PASSWORD` over the length cap fails closed (Greptile
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
v1.10.0 (2026-07-17): **Deployment Protection Exceptions** implemented
(`DEPLOY_GATE_UNPROTECTED_HOSTS`) in both templates, completing parity with all
three Advanced Deployment Protection features — previously the skill claimed two
of three. Matching mirrors Vercel's exception axis (the *domain*): exact host,
case-insensitive, port-stripped, deliberately **not** suffix/wildcard (a suffix
match on "acme.com" would unprotect every subdomain from one typo), evaluated
before the config check so an exception survives a malformed hash, and inert when
unset so existing installs are unaffected. Definition verified against Vercel's
Deployment Protection Exceptions docs, 2026-07-17 ("disable Deployment Protection
… for a list of preview domains") — note this is domain-scoped, which is why the
path-level `matcher` was never an equivalent. Host-matching logic smoke-tested
over 15 cases (2026-07-17), including the substring/suffix/prefix-extension
attacks and missing-Host fail-closed; both templates typecheck clean.
v1.10.1 (2026-07-17, two independent Fable review agents): **corrected a false
competitive claim inherited from earlier versions.** The skill said Vercel's
Protection Bypass for Automation is "ONE secret per project" and that our named
tokens "improve on" it. Vercel's docs (updated 2026-04-30) say the opposite:
"You can create **multiple bypass secrets per project** to manage access
independently for different tools" — each revocable, and theirs *also* clears
Firewall/bot challenges, which ours can't. Corrected to parity in the
description, body, and README. Lesson recorded for future edits: **the
competitor's product changes underneath a comparison claim** — re-verify "better
than" statements against live docs, never carry them forward. Also fixed same
pass: Shareable Links are available on Hobby (capped at one per account), not
"Pro+"; the speed-bump gotcha said "never point it at production", contradicting
the production-gating the skill now supports (rephrased to "not for real user
data" — the actual guardrail); the exceptions section now discloses that removing
a host re-protects only new builds (Vercel's is immediate), that a listed host is
Vercel-only-safe, and that malformed entries are warned-and-ignored; the Hobby
"unbuyable" claim is now labelled an inference from the plan listings rather than
"verified"; "no theming hook" → "no *documented* theming hook" everywhere;
"the build strips the gate" scoped to Mode B. Code fixes from the same review:
`normalizeHost` no longer splits IPv6 literals on the first colon (a fail-OPEN
bug — listing "[2001:db8::1]" collapsed to "[2001" and unprotected every address
sharing that hextet), trailing-dot FQDNs now match, non-hostname entries (e.g. a
pasted URL) are warned-and-ignored instead of silently half-parsed, and the
Host-trust comment no longer argues from attacker capability (a non-sequitur —
forging Host to reach a *different* deployment is exactly what a gate must stop)
but from the real reason: Vercel's edge routes on the same Host the middleware
reads, so the two can't desync. Off Vercel that property doesn't hold and the
var must not be used — now stated in code and docs. Re-verified: 24 host-matching
cases pass against code extracted from the template itself.
v1.11.0 (2026-07-17): renamed the skill (`vercel-preview-password-gate` →
`vercel-deployment-password-gate`) and every config var to the `DEPLOY_GATE_`
prefix, because the gate protects production too and the `PREVIEW_` names were
misleading. All internal identifiers followed: cookie `preview_gate` →
`deploy_gate`, unlock path `/__preview-unlock` → `/__deploy-unlock`, bypass
header `x-preview-gate-bypass` → `x-deploy-gate-bypass`, build marker
`@preview-gate:managed` → `@deploy-gate:managed` (kept in lock-step with the
removal script that greps for it), log prefix, HMAC cookie context, and the
legacy-plaintext salt. Back-compat is deliberate and tested: `readGateEnv` reads
the new env name, falls back to the old one with a one-time deprecation warning,
and the new name wins if both are set — because absent config fails OPEN, a
silent rename would have unprotected every deployment on upgrade. The cookie-name
and HMAC-context change re-prompts already-unlocked users once (harmless); the
bypass header rename is breaking for automation callers, acceptable pre-publish.
Verified after the rename: both templates typecheck clean, 7 config-fallback
cases pass (legacy alias still parses → no fail-open; new name wins; legacy
plaintext honoured; tokens under both names) and all 24 host-matching cases still
pass, all against functions extracted from the renamed templates.

v1.11.1 (2026-07-17, two more Fable review agents on PR #24 findings): closed two
fail-open holes and fixed the install-blockers a review pass surfaced.
- **F4 (fail-open):** a Vercel preview with "System Environment Variables"
  disabled exposes no `VERCEL_*` var, so `target` read `undefined` and the
  predicate passed through UNGATED even with a password set. Now `undefined`
  fails open only when nothing is configured; credentials-present + unknown-env
  gates. Host exceptions honored only when target is a known Vercel env (Host is
  spoofable off-Vercel). Verified: 16 end-to-end gate cases against the real
  previewGate.
- **F5 (fail-open):** token-only deployment + malformed `DEPLOY_GATE_BYPASS_TOKENS`
  (bad JSON, `{}`, `{"ci":123}`) logged a warning and failed OPEN. bypassTokens
  now reports absent-vs-malformed; present-but-unusable tokens fail closed (503)
  when they're the sole credential; a valid password + broken tokens stays gated
  by password (no spurious 503).
- **YAML frontmatter was invalid** (unquoted description contained "features: " —
  colon-space), which the skills CLI's parser rejects → the skill wouldn't
  list/install. Description now quoted and trimmed to ≤1024 chars (the documented
  limit; was 1330).
- **Template files renamed** preview-gate.ts → deploy-gate.ts / deploy-gate.vercel.ts
  to match the SKILL.md links (the v1.11.0 rename updated the references but not
  the files — an install blocker).
- **Mode B src-layout:** documented that `proxy.ts` must sit next to `app`/`pages`
  (i.e. `src/proxy.ts` in a src layout) or previews deploy ungated; added a
  post-install `curl` check. remove-proxy-on-prod.mjs now scans all install
  paths and warns loudly instead of silently no-opping.
- **Rotation workflows:** switched to `vercel env update` (no rm→add fail-open
  window); documented that Preview `env add` defaults to **sensitive** (values
  can't be read back), so token/host maps need `--no-sensitive`; fixed the
  bypass-token write-back to pipe the exact captured JSON (a re-run minted a
  different token).
- **F2:** the stdin password prompt echoed plaintext — muted via readline
  `_writeToOutput`; verified under a pty. **F3:** removal script candidate-scan
  (above). **F1** (greptile "cookie request-only") rejected as safe: `next({headers})`
  sets response headers, verified against @vercel/functions source.
- Neutralized preview-specific unlock-form copy (the gate protects production
  too). All fixes verified: 16 gate + 24 host + 7 config-fallback cases pass
  against code extracted from the templates; both templates typecheck clean.

v1.11.2 (2026-07-17): refined the F4 local-vs-preview detection. v1.11.1 gated
whenever the Vercel target was unknown and credentials were present — correct for
a toggle-off preview, but it also gated a plain `next dev` that had preview creds
pulled into `.env.local`. Added a precise local-dev escape: pass when
`VERCEL_TARGET_ENV`/`VERCEL_ENV` is undefined AND `NODE_ENV === "development"`.
`next dev` / Vite dev servers set NODE_ENV=development; a Vercel deployment always
runs NODE_ENV=production — including a preview with System Environment Variables
disabled (the only other undefined-target case), and NODE_ENV is not one of the
toggle-gated VERCEL_* vars — so the escape restores local-dev convenience without
reopening the leak. The documented local-test flow (VERCEL_TARGET_ENV=preview)
sets a defined target, so it still gates. Verified: 6 NODE_ENV cases + the
existing 16 end-to-end gate cases pass. NODE_ENV's exclusion from the System
Environment Variables list confirmed against Vercel's docs, 2026-07-17.

v1.11.3 (2026-07-17): made the framework-agnostic template genuinely
framework-neutral. Its `config.matcher` had inherited Next.js's `_next/static` /
`_next/image` exclusions — dead paths outside Next. Replaced with an
extension-only static-asset exclusion that covers hashed build output for every
framework (SvelteKit `/_app`, Nuxt `/_nuxt`, Astro `/_astro`, Remix `/build`,
Vite `/assets` are all *.js/*.css), $-anchored so a page merely containing ".js"
in its path is still gated, and with `.json` deliberately NOT excluded so a
locked deployment doesn't serve data files. Verified `config.matcher`, `next()`
from `@vercel/functions`, root `middleware.ts`, and `runtime: "nodejs"` are the
correct Routing Middleware conventions for non-Next frameworks against Vercel's
Routing Middleware + API docs (2026-07-01). Also fixed a stale docblock comment
referencing the removal script's old `targetPath` (it now scans candidate paths
by marker). Matcher behavior smoke-tested over 10 paths; both templates typecheck
clean.

v1.11.4 (2026-07-17, PR #24 round-3 Codex findings on the latest commits):
- **Blank configured secret failed open (P2).** A present-but-empty
  DEPLOY_GATE_PASSWORD_HASH="" (or whitespace, or a blank DEPLOY_GATE_PASSWORD)
  trimmed to falsy and fell through as if the var were absent → fail open. Now
  present-but-blank returns "malformed" (503), matching the malformed-hash
  contract; bypassTokens does the same for a blank token var. Fresh-clone
  (var unset) still fails open. Verified: 7 blank-secret cases + the 16-case
  e2e suite pass.
- **Production-gating recipe leaked on undefined (P2).** The "Gating production
  too" predicate snippet still passed on a bare `target === undefined`, which is
  the System-Env-disabled Vercel case — following it for a coming-soon prod site
  would leave it public. Updated the snippet to the stock local-dev guard
  (`undefined && NODE_ENV === "development"`).
- **Non-Next Routing Middleware must be at repo root (P1 doc).** The Mode B note
  said the framework-agnostic file could live at `src/middleware.ts`; Vercel only
  loads Routing Middleware from the project root (beside package.json), so a src/
  copy is silently ignored → ungated preview. Corrected to root-only; the `src/`
  guidance is Next `proxy.ts`-only. Verified against Vercel Routing Middleware
  API docs (2026-07-01).
Re-confirmed the Greptile re-posts on the latest commit are already-handled: F1
(bypass cookie) rejected-safe, F2 (prompt echo) fixed, F3 (strip target) fixed.

v1.11.5 (2026-07-17, PR #24 round-4 — CodeRabbit / Codex / Copilot on the latest push):
- **Blank hash/password/token now fails closed** (verified — a round-3 fix; CodeRabbit
  re-flagged it against the pre-fix commit). Confirmed in-file.
- **Matcher no longer exempts arbitrary `.txt` / `.xml`** (CodeRabbit): those extensions
  are removed from the static-asset exclusion in both templates, so only robots.txt /
  sitemap.xml (excluded by exact name) stay public; other text/XML routes are gated.
- **Unlock cookie `Secure` is now conditional on request protocol** (Copilot): defaults
  on (every real Vercel deploy is https), off for a plain-http origin so the documented
  `http://localhost` local test persists the cookie. `withUnlockCookie` gained an
  optional `secure` param; `cookieHeader` a required one; call sites pass
  `protocol === "https:"`.
- **Mode A src-layout** (Codex): the helper must sit beside the host proxy
  (`src/lib/deploy-gate.ts` for a `src/proxy.ts` host) or the relative import breaks;
  documented, and the example now passes the protocol-derived `secure` flag.
- **pageExtensions** (Codex, verified against Next proxy docs): an app customising
  `pageExtensions` must name the file `proxy.page.ts` or Next ignores it (silent
  ungate); documented in Mode B.
- Docs: intro now states the conditional unset-target fail-open accurately (CodeRabbit);
  README qualifies the Hobby "only option" claim as an inference (CodeRabbit); codemod
  tag `@latest` → `@canary` to match Next's docs; fixed a double em-dash in the
  deploy-gate.ts docblock (Copilot).
- **Rejected:** Greptile "bypass cookie stays request-only" — re-confirmed safe
  (`next({ headers })` sets response headers, verified against @vercel/functions).
Verified: 16 e2e + 7 blank-secret + 6 NODE_ENV gate cases pass; matcher and cookie
behavior smoke-tested; both templates typecheck clean.

v1.11.6 (2026-07-17, PR #24 — Codex re-review of the round-4 matcher change):
**Anchored the exact-file matcher exclusions.** `favicon.ico|robots.txt|sitemap.xml`
were unanchored prefixes with unescaped dots, so a page like `/sitemap.xml-preview`,
`/robots.txt/secret`, or `/robotsXtxt` prefix-matched a metadata-file exemption and
deployed PUBLIC. Now `\.`-escaped and `$`-anchored in both matchers, so only the real
files stay public and lookalike pages gate. (`_next/static|_next/image` stay directory
prefixes — that namespace is Next-reserved.) Verified: the fix gates the 4 bypass
variants and keeps the 3 real metadata files public, tested against the regex extracted
from the template; 16 e2e + 7 blank-secret + 6 NODE_ENV gate cases still pass; both
templates typecheck.

v1.11.7 (2026-07-17, PR #24 — Codex P1 on the framework-agnostic matcher):
**Documented that excluded static assets are public**, and how to gate them. The
matcher lets `.js`/`.css`/image/font/map requests skip the gate — fine for an SSR
app (framework code), but a static export or SPA often bakes content/data into the
hashed JS bundle, so anyone who learns an asset URL could fetch it without the
password. Rather than flip the default (the skill relies on same-origin assets for
the unlock-page logo, and calls itself a "speed bump, not auth"), added a
prominent SECURITY note in the framework-agnostic matcher comment + a "Static
assets are public" gotcha in SKILL.md with the gate-everything alternative
(`matcher: "/((?!favicon\.ico$).*)"` + inline the logo as a data URI). Cost is one
cookie-compare per asset request; scrypt runs only on the unlock POST. Verified the
gate-everything matcher gates bundles/data while keeping the tab icon public; both
templates typecheck. Doc-only — no gate-logic change.

v1.11.8 (2026-07-17, PR #24 — two Codex P2s on the round-7 code):
- **Bypass token no longer forwarded upstream.** A header-bypassed request had
  `x-deploy-gate-bypass` passed to the app (via NextResponse.next() / next()), so
  app routes, server actions, and request logging saw the long-lived token — the
  query-param path already stripped it, so this was an inconsistency. Both Mode B
  wrappers now delete the header from the forwarded request; the Mode A example
  documents doing the same. Verified: the middleware strips the bypass header,
  keeps other headers, and still persists the cookie.
- **Host exceptions need the System-Env toggle — documented.** With System
  Environment Variables disabled, `target` is undefined, so host exceptions
  (`DEPLOY_GATE_UNPROTECTED_HOSTS`) are correctly not honored (Host is only
  trusted on a known Vercel env) — but a host the user marked public then stays
  gated. Corrected the "only cost of the toggle is the strip" note to add this,
  and flagged the toggle requirement in "Unprotect specific domains". Not a
  behavior change (keeping the Host-spoof protection is right) — the fix is the
  docs.
Both templates typecheck; 16 e2e + 7 blank-secret + 6 NODE_ENV gate cases pass.

v1.11.9 (2026-07-17, PR #24 — Codex P2 on the exception-only config state):
**A host-exception list with no password/token no longer fails open.** Setting
DEPLOY_GATE_UNPROTECTED_HOSTS alone (e.g. in a custom env where only the exception
list was added) hit the "fully unconfigured → fail open" branch and made EVERY
host public — even though declaring exceptions means "these hosts public, the rest
gated". Now a declared exception list counts as configured state: it suppresses the
fail-open, listed hosts stay public, and non-listed hosts fail CLOSED (503, message
names the missing-credential cause). Same fail-open-on-misconfiguration class as the
blank-secret fixes. `isUnprotectedHost` now takes the parsed allowlist (computed once
in previewGate). Verified: 8 exception-config cases (listed→pass, non-listed→503,
+password→normal, fresh-clone still fails open, toggle-off→503) plus the full
regression — 16 e2e + 7 blank + 6 NODE_ENV + 24 host — all pass; both templates
typecheck.

v1.11.10 (2026-07-18, PR #24 — the config-state matrix, closed):
Final consolidated pass over the CodeRabbit/Codex findings so the fail-open matrix
stops leaking edge cases.
- **CodeRabbit Major (verified fail-open):** a DECLARED-but-blank/all-invalid
  DEPLOY_GATE_UNPROTECTED_HOSTS (e.g. `""` or a typo'd host) with no password/token
  was indistinguishable from unset and failed OPEN. Now "declared" = the var is set
  at all (`process.env.… !== undefined`), which — like a blank hash/token — counts
  as configured: it suppresses the fail-open, so a declared-blank list fails CLOSED
  (503) for non-exception hosts. Unset (a real fresh clone) still fails open.
- **Codex P2 (bearer secret):** documented that the stored hash is itself a bearer
  secret — the unlock cookie is HMAC(key=hash, fixed message), so a leaked
  DEPLOY_GATE_PASSWORD_HASH forges access without the plaintext; rotate on any hash
  disclosure, not just a plaintext leak. scrypt protects the plaintext, not access.
- **Codex P2 (Mode A sample):** the Mode A example showed stripping the bypass
  header into an unused variable but passed the raw request to the host logic —
  misleading. Now it builds a cleaned NextRequest and passes that, with a note for
  request-less host pipelines.
- **CodeRabbit Minor (matcher dot):** the documented gate-everything example used
  `favicon\.ico` (single backslash) — in a JS string that collapses to an
  UNESCAPED regex dot. Fixed to `favicon\\.ico` so the emitted regex escapes it,
  matching the template code.
- **Rejected — CodeRabbit "pin the codemod version":** `@canary` is what Next's
  official proxy docs use; pinning a one-time codemod to an exact version defeats
  getting its latest transforms. Kept `@canary`.
Verified: the declared-blank host var now 503s (was a leak); full regression — 8
exception-config + 16 e2e + 7 blank + 6 NODE_ENV — all pass; both templates typecheck.

v1.11.11 (2026-07-18, PR #24 — CodeRabbit Major on the Mode A sample):
The Mode A example that reconstructs a NextRequest to strip the bypass header
passed `body: request.body` (a stream) without `duplex: "half"` — which throws
`RequestInit: duplex option is required when sending a body` on any request with
a body (POST/PUT). Added `duplex: "half"` (verified it's required for a stream
body and harmless with a null body / GET). Doc-only.
