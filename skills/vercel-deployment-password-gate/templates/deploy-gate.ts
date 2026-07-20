/* @deploy-gate:managed — scripts/remove-proxy-on-prod.mjs strips this file
 * from Vercel production builds; keep this marker line if you edit the file. */
/**
 * Deployment password gate for Vercel — portable, dependency-free.
 *
 * Mode B (app has no other middleware): check this file in AS `proxy.ts` at
 * the app root. Lifecycle:
 *   - local dev / non-Vercel / VERCEL_TARGET_ENV "development": runs but no-ops
 *   - Vercel preview OR any custom environment (VERCEL_TARGET_ENV, e.g.
 *     "staging"): gate active
 *   - Vercel production: remove-proxy-on-prod.mjs deletes the file at build
 *     time → the deployment ships no middleware function at all
 *
 * Mode A (app already has middleware/proxy): place at lib/deploy-gate.ts,
 * call `previewGate(request)` first inside the existing function, and do NOT
 * use the removal script.
 *
 * Human auth: DEPLOY_GATE_PASSWORD_HASH holds `s2:<salt>:<scryptHex>`
 * — generate with templates/hash-password.mjs. The plaintext is never stored.
 *
 * Automation auth (mimics Vercel's Protection Bypass for Automation):
 * DEPLOY_GATE_BYPASS_TOKENS holds JSON `{"<label>":"<token>", ...}` — manage
 * with templates/bypass-tokens.mjs. Send a token via the
 * `x-deploy-gate-bypass` header or query parameter. Tokens are plaintext by
 * design: automation must read them back. Bypass accepts TOKENS ONLY — the
 * human password unlocks solely via the form (see matchBypass for why).
 *
 * Unlock cookies are HMACs keyed on the credential that minted them, so
 * rotating the password (or removing a bypass token) invalidates exactly the
 * cookies that credential issued.
 *
 * Requires Node runtime (Next 16 proxy default). For Next ≤15 edge middleware,
 * swap node:crypto for Web Crypto — see the skill's Gotchas.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "deploy_gate";
const UNLOCK_PATH = "/__deploy-unlock";
const BYPASS_PARAM = "x-deploy-gate-bypass"; // header and query parameter share this name
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year — "unlock once"
// Bounds the scrypt input on unlock POSTs (its PBKDF2 pre-hash scales with
// input length). hash-password.mjs enforces the same cap — keep them in sync.
const MAX_PASSWORD_LENGTH = 256;

type GateConfig = { salt: string; hash: string };
type BypassTokens = Record<string, string>;

/**
 * Gate outcome: `block` is a complete response to return immediately;
 * `setCookie` asks the caller to attach the unlock cookie to whatever
 * response its own pipeline produces (so header-bypassed requests still get
 * the host middleware's routing/rewrites).
 */
export type PreviewGateResult = { block?: NextResponse; setCookie?: string };

// Absent config fails OPEN (a fresh clone must not brick its previews), but
// PRESENT-and-malformed config fails CLOSED: the operator clearly intended
// protection, so a typo must not silently publish the preview.
type GateConfigState = GateConfig | null | "malformed";

// Env is deployment-constant; memoize so the legacy-plaintext scrypt cost is
// paid once per instance, not per request.
let cachedConfig: GateConfigState | undefined;

function gateConfig(): GateConfigState {
  if (cachedConfig !== undefined) return cachedConfig;
  cachedConfig = loadGateConfig();
  return cachedConfig;
}

// Config vars are DEPLOY_GATE_* — the gate protects production too, so the old
// PREVIEW_* spelling was a lie. The old names still work (with a warning)
// because absent config FAILS OPEN by design: a silent rename would find no
// password and quietly unprotect every deployment on upgrade.
const LEGACY_ENV_NAMES: Record<string, string> = {
  DEPLOY_GATE_PASSWORD_HASH: "PREVIEW_PASSWORD_HASH",
  DEPLOY_GATE_PASSWORD: "PREVIEW_PASSWORD",
  DEPLOY_GATE_BYPASS_TOKENS: "PREVIEW_GATE_BYPASS_TOKENS",
};
const warnedLegacy = new Set<string>();

function readGateEnv(name: keyof typeof LEGACY_ENV_NAMES | string): string | undefined {
  const current = process.env[name];
  if (current !== undefined) return current;
  const legacyName = LEGACY_ENV_NAMES[name];
  if (!legacyName) return undefined;
  const legacy = process.env[legacyName];
  // Warn once per instance, not per request — bypassTokens() is not memoized.
  if (legacy !== undefined && !warnedLegacy.has(legacyName)) {
    warnedLegacy.add(legacyName);
    console.warn(
      `[deploy-gate] ${legacyName} is deprecated — rename it to ${name}. Still honoured, but rename before the old name is dropped.`,
    );
  }
  return legacy;
}

function loadGateConfig(): GateConfigState {
  const rawHash = readGateEnv("DEPLOY_GATE_PASSWORD_HASH");
  const stored = rawHash?.trim();
  // Present but blank (empty / whitespace) → the operator TRIED to configure it
  // (a failed secret write, a blank dashboard value). Fail closed — do NOT fall
  // through to "unconfigured → open", which would publish a preview they meant
  // to protect.
  if (rawHash !== undefined && stored === "") {
    console.warn("[deploy-gate] DEPLOY_GATE_PASSWORD_HASH is set but blank — failing closed");
    return "malformed";
  }
  if (stored) {
    const match = /^s2:([0-9a-f]+):([0-9a-f]{64})$/i.exec(stored);
    if (match) return { salt: match[1], hash: match[2].toLowerCase() };
    console.warn("[deploy-gate] DEPLOY_GATE_PASSWORD_HASH is malformed — failing closed");
    return "malformed";
  }
  // Legacy fallback: plaintext env var (DEPLOY_GATE_PASSWORD / PREVIEW_PASSWORD), normalized to the same scheme.
  const plain = readGateEnv("DEPLOY_GATE_PASSWORD");
  if (plain !== undefined && plain.trim() === "") {
    console.warn("[deploy-gate] DEPLOY_GATE_PASSWORD is set but blank — failing closed");
    return "malformed";
  }
  if (plain) {
    // Enforce the unlock-POST length cap here too: an over-long legacy password
    // would otherwise hash into a valid config the POST guard always rejects,
    // leaving the deployment gated with no way in. Fail closed instead.
    if (plain.length > MAX_PASSWORD_LENGTH) {
      console.warn("[deploy-gate] DEPLOY_GATE_PASSWORD exceeds the max length — failing closed");
      return "malformed";
    }
    return {
      salt: "deploy-gate-legacy",
      hash: hashPassword("deploy-gate-legacy", plain),
    };
  }
  return null;
}

// `absent`: the var is unset (a fresh clone must fail open). `malformed`: the
// var is PRESENT but yielded zero usable tokens (bad JSON, not an object, empty
// `{}`, or every entry a non-string like `{"ci":123}`). Present-but-unusable is
// treated like a malformed password hash: when tokens are the ONLY credential
// it fails closed (see previewGate) rather than silently publishing.
type BypassTokenState = { map: BypassTokens; absent: boolean; malformed: boolean };

function bypassTokens(): BypassTokenState {
  const rawVar = readGateEnv("DEPLOY_GATE_BYPASS_TOKENS");
  if (rawVar === undefined) return { map: {}, absent: true, malformed: false };
  const raw = rawVar.trim();
  const map: BypassTokens = {};
  if (raw !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [label, token] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof token === "string" && token.length > 0) map[label] = token;
        }
      }
    } catch {
      // leave map empty → malformed below
    }
  }
  // Present (even if blank) but no usable tokens → misconfigured. Same reasoning
  // as a blank hash: the var is set, so the operator intended protection.
  const malformed = Object.keys(map).length === 0;
  if (malformed) {
    console.warn(
      "[deploy-gate] DEPLOY_GATE_BYPASS_TOKENS is set but yielded no usable tokens (blank, bad JSON, not an object, or empty) — treating as misconfigured",
    );
  }
  return { map, absent: false, malformed };
}

// Deployment Protection Exceptions equivalent: hosts listed here skip the gate
// entirely and are PUBLIC. Mirrors Vercel's feature, whose exception axis is the
// domain (not the path — that's what `matcher` is for). Comma-separated, e.g.
// DEPLOY_GATE_UNPROTECTED_HOSTS="demo.acme.com, staging.acme.com".
// Matching is exact, case-insensitive, port-stripped — never suffix/substring:
// a suffix match on "acme.com" would unprotect every subdomain at once.
// Bare DNS names only: an entry that isn't one is ignored with a warning rather
// than half-parsed (pasting "https://demo.acme.com/" would otherwise silently
// leave the domain gated, and an IPv6 literal would silently widen the list).
const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

function unprotectedHosts(): string[] {
  const raw = process.env.DEPLOY_GATE_UNPROTECTED_HOSTS?.trim();
  if (!raw) return [];
  const hosts: string[] = [];
  for (const entry of raw.split(",")) {
    if (entry.trim().length === 0) continue;
    const host = normalizeHost(entry);
    if (!HOSTNAME_PATTERN.test(host)) {
      console.warn(
        `[deploy-gate] DEPLOY_GATE_UNPROTECTED_HOSTS: ignoring ${JSON.stringify(entry.trim())} — expected a bare hostname like "demo.acme.com" (no scheme, path, or IP literal). That domain stays GATED.`,
      );
      continue;
    }
    hosts.push(host);
  }
  return hosts;
}

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase();
  // Strip a trailing :port without splitting IPv6 literals apart (a bare
  // split(":") would turn "[2001:db8::1]" into "[2001" and, with a prefix
  // match, silently unprotect every address sharing that hextet).
  const withoutPort = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/.exec(host)?.[1] ?? host;
  // "acme.com." is a valid absolute FQDN and is DNS-equal to "acme.com".
  return withoutPort.endsWith(".") ? withoutPort.slice(0, -1) : withoutPort;
}

function isUnprotectedHost(request: NextRequest, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  // SCOPE: this is safe ON VERCEL because Vercel's edge selects the deployment
  // from this same Host value, so the header cannot be desynced from the
  // deployment it routed to — forging it just routes you to the public host you
  // claimed. That is a property of Vercel's routing, NOT of the attacker's
  // capability. Off Vercel (self-hosted, or any proxy that routes on the
  // absolute-form target or TLS SNI while forwarding the client's Host
  // verbatim), Host is attacker-controlled and this check is a straight auth
  // bypass — do not use this env var there.
  const host = normalizeHost(request.headers.get("host") ?? "");
  if (!host) return false;
  return allowlist.includes(host);
}

// scrypt (memory-hard KDF), not plain SHA-256 — raises offline brute-force
// cost if the stored hash leaks. CodeQL js/insufficient-password-hash flagged
// the earlier salted-SHA-256 scheme in a real install (2026-07-17). Cost is
// paid only on unlock attempts (and once per instance for legacy plaintext).
function hashPassword(salt: string, password: string): string {
  return scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
}

// Keyed on the stored credential rather than a separate signing secret: a
// separate secret would live in the same env store as the hash AND the
// plaintext bypass tokens, so it cannot widen the trust boundary. Keying
// per-credential is what buys instant revocation on rotation.
function mintCookie(key: string, purpose: "unlocked" | "bypass"): string {
  return createHmac("sha256", key).update(`deploy-gate:${purpose}:v1`).digest("hex");
}

function validCookieValues(config: GateConfig | null, tokens: BypassTokens): string[] {
  const values: string[] = [];
  if (config) values.push(mintCookie(config.hash, "unlocked"));
  for (const token of Object.values(tokens)) values.push(mintCookie(token, "bypass"));
  return values;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function verifyPassword(config: GateConfig, attempt: string): boolean {
  return safeEqual(hashPassword(config.salt, attempt), config.hash);
}

/**
 * Match a bypass token from header or query param; returns the cookie to mint.
 * Tokens ONLY, compared with cheap constant-time equality. The human password
 * is deliberately NOT accepted here: verifying it costs a scrypt run
 * (memory-hard by design), so honoring it on this every-request path would
 * turn a flood of bogus bypass values into a CPU-DoS amplifier — and a
 * password in a URL/header ends up in logs. Password = the unlock form.
 */
function matchBypass(
  request: NextRequest,
  tokens: BypassTokens,
): { cookieValue: string; viaQuery: boolean } | null {
  const candidates: Array<[string | null, boolean]> = [
    [request.headers.get(BYPASS_PARAM), false],
    [request.nextUrl.searchParams.get(BYPASS_PARAM), true],
  ];
  for (const [candidate, viaQuery] of candidates) {
    if (!candidate) continue;
    for (const token of Object.values(tokens)) {
      if (safeEqual(candidate, token)) {
        return { cookieValue: mintCookie(token, "bypass"), viaQuery };
      }
    }
  }
  return null;
}

// Same-origin relative paths only. Reject "//" (protocol-relative) and "\"
// (browsers normalize it to "/"). Control characters must ALSO be rejected:
// the WHATWG URL parser strips tab/CR/LF, so "/\t/evil.com" would re-form
// into protocol-relative "//evil.com" inside `new URL(path, base)` — an open
// redirect that the prefix checks alone cannot catch.
function sanitizeReturnPath(raw: string | null): string {
  if (
    raw &&
    raw.startsWith("/") &&
    !raw.startsWith("//") &&
    !raw.includes("\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(raw)
  ) {
    return raw;
  }
  return "/";
}

// .replace(/…/g), not String.replaceAll — replaceAll needs an ES2021 lib
// target and host tsconfigs routinely predate that (broke a real install).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unlockFormHtml(returnPath: string, failed: boolean): string {
  const action = `${UNLOCK_PATH}?from=${encodeURIComponent(returnPath)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Locked</title>
<style>
  :root { color-scheme: light dark; }
  body { min-height: 100dvh; display: grid; place-items: center; margin: 0;
         font-family: system-ui, sans-serif; }
  form { display: grid; gap: 0.75rem; width: min(20rem, 90vw); text-align: center; }
  input, button { font: inherit; padding: 0.6rem 0.8rem; border-radius: 0.5rem; }
  input { border: 1px solid #8888; }
  button { border: 0; background: #111; color: #fff; cursor: pointer; }
  @media (prefers-color-scheme: dark) { button { background: #eee; color: #111; } }
  .err { color: #c00; margin: 0; }
</style>
</head>
<body>
<form method="post" action="${escapeHtml(action)}">
  <h1>This deployment is locked</h1>
  ${failed ? '<p class="err">Wrong password — try again.</p>' : ""}
  <input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password" />
  <button type="submit">Unlock</button>
</form>
</body>
</html>`;
}

function htmlResponse(html: string, status = 401): NextResponse {
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

// `secure` defaults true (every real Vercel deployment is https). Pass false
// only for a plain-http origin — i.e. the documented `http://localhost` local
// test — where a Secure cookie may be dropped and the unlock wouldn't persist.
export function withUnlockCookie<T extends NextResponse>(
  response: T,
  token: string,
  secure = true,
): T {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}

/**
 * Evaluate the gate. `{ block }` = respond immediately; `{ setCookie }` =
 * continue the caller's pipeline and attach the unlock cookie to its
 * response; `{}` = pass through untouched.
 */
export async function previewGate(
  request: NextRequest,
): Promise<PreviewGateResult> {
  // Gate every remote non-production Vercel deployment: `preview` AND any
  // custom environment (e.g. a named "staging"). Never gate production (also
  // stripped from prod builds in Mode B), local dev, or non-Vercel hosts.
  // Key off VERCEL_TARGET_ENV, not VERCEL_ENV: VERCEL_ENV only ever reports
  // production/preview/development, collapsing every custom environment into
  // one of those buckets, so a custom target (e.g. "staging") could read
  // VERCEL_ENV=production and slip through ungated. VERCEL_TARGET_ENV carries
  // the custom name; fall back to VERCEL_ENV when it's absent (older Vercel,
  // non-Vercel, local). Gate every remote target except production.
  const target = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV;
  // Never gate true production, or a Vercel `development` target (`vercel dev`).
  if (target === "production" || target === "development") return {};

  // Local dev server: no Vercel target AND NODE_ENV=development. `next dev`
  // (and Vite-based dev servers) set NODE_ENV=development; a Vercel deployment
  // always runs NODE_ENV=production — including a preview with "System
  // Environment Variables" disabled, which is the only other case where target
  // reads `undefined`. NODE_ENV is NOT one of the toggle-gated VERCEL_* vars,
  // so it's still readable when they're hidden. This keeps `next dev` ungated
  // even with preview creds pulled into .env, WITHOUT ungating a real preview.
  // The documented "test the gate locally" flow sets VERCEL_TARGET_ENV=preview,
  // so target is defined and this branch doesn't apply — the gate still runs.
  if (target === undefined && process.env.NODE_ENV === "development") return {};

  const configState = gateConfig();
  const tokens = bypassTokens();
  const hosts = unprotectedHosts();
  // "Declared" = the var is SET (even blank / all-invalid), which — like a blank
  // hash or token map — signals intent to protect. `hosts.length` alone can't
  // tell a declared-but-blank list from an unset one, and conflating them would
  // let a typo'd exception list reach the fail-open below.
  const hostsDeclared = process.env.DEPLOY_GATE_UNPROTECTED_HOSTS !== undefined;

  // Fully unconfigured → fail open (fresh clone, or non-Vercel with no gate
  // env). This — NOT a blanket `target === undefined` pass — is what keeps CI
  // and misc hosts from bricking. When target is `undefined` but NODE_ENV isn't
  // "development" (a Vercel preview with System Env Vars disabled) and
  // credentials ARE present, we fall through and gate rather than leak. A
  // declared host-exception list COUNTS as configured (it means "these hosts
  // public, the REST gated"), so it too suppresses the fail-open.
  if (configState === null && tokens.absent && !hostsDeclared) return {};

  // Deployment Protection Exceptions equivalent: an explicitly listed host is
  // public. Honored BEFORE the malformed 503 so an exception survives a bad
  // hash — but ONLY when target is a known Vercel env: the check trusts the Host
  // header, which is safe only because Vercel's edge routes on it. When target
  // is undefined (env hidden, or off-Vercel) Host is spoofable, so skip it.
  if (target !== undefined && isUnprotectedHost(request, hosts)) return {};

  // Present-but-unusable config → fail closed. A malformed hash / over-long
  // legacy password; unusable token JSON when tokens are the SOLE credential;
  // OR a host-exception list declared with NO password/token to gate the
  // non-exception hosts (reaching here with config null + tokens absent means
  // hosts were declared — the fail-open above required an empty list). When a
  // valid hash coexists with broken tokens the deployment stays gated by
  // password, so that isn't a 503.
  if (
    configState === "malformed" ||
    (configState === null && tokens.malformed) ||
    (configState === null && tokens.absent)
  ) {
    return {
      block: new NextResponse(
        "Deployment gate misconfigured — DEPLOY_GATE_PASSWORD_HASH is not a valid s2 hash, DEPLOY_GATE_PASSWORD exceeds the maximum length, DEPLOY_GATE_BYPASS_TOKENS yielded no usable tokens, or DEPLOY_GATE_UNPROTECTED_HOSTS is set with no password/token to gate the other hosts.",
        { status: 503, headers: { "cache-control": "no-store" } },
      ),
    };
  }
  const config = configState;

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (cookie && validCookieValues(config, tokens.map).some((v) => safeEqual(cookie, v))) {
    return {};
  }

  // Automation bypass — a header bypass passes through WITHOUT ending the
  // request (the host pipeline still runs); the query variant redirects to a
  // cleaned URL (token out of the address bar) with the cookie persisted.
  const bypass = matchBypass(request, tokens.map);
  if (bypass) {
    if (bypass.viaQuery) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.searchParams.delete(BYPASS_PARAM); // removes ALL occurrences
      const redirect = NextResponse.redirect(cleanUrl, 303);
      redirect.headers.set("cache-control", "no-store");
      return { block: withUnlockCookie(redirect, bypass.cookieValue, request.nextUrl.protocol === "https:") };
    }
    return { setCookie: bypass.cookieValue };
  }

  // Token-only configuration has no password to prompt for.
  if (!config) {
    return {
      block: new NextResponse("Locked — automation bypass required.", {
        status: 401,
        headers: { "cache-control": "no-store" },
      }),
    };
  }

  if (request.method === "POST" && request.nextUrl.pathname === UNLOCK_PATH) {
    const form = await request.formData().catch(() => null);
    const attempt = form?.get("password");
    const returnPath = sanitizeReturnPath(request.nextUrl.searchParams.get("from"));
    if (
      typeof attempt === "string" &&
      attempt.length > 0 &&
      attempt.length <= MAX_PASSWORD_LENGTH &&
      verifyPassword(config, attempt)
    ) {
      const redirect = NextResponse.redirect(new URL(returnPath, request.url), 303);
      redirect.headers.set("cache-control", "no-store");
      return {
        block: withUnlockCookie(redirect, mintCookie(config.hash, "unlocked"), request.nextUrl.protocol === "https:"),
      };
    }
    return { block: htmlResponse(unlockFormHtml(returnPath, true)) };
  }

  return {
    block: htmlResponse(
      unlockFormHtml(
        sanitizeReturnPath(request.nextUrl.pathname + request.nextUrl.search),
        false,
      ),
    ),
  };
}

/** Mode B entry point — this file is the app's proxy.ts. */
export async function proxy(request: NextRequest) {
  const gate = await previewGate(request);
  if (gate.block) return gate.block;
  // Strip the bypass token from the headers forwarded upstream, so app routes /
  // server actions / request logging never see it (the query-param path already
  // strips it from the URL). Harmless to always strip — the header only means
  // something to the gate.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(BYPASS_PARAM);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return gate.setCookie
    ? withUnlockCookie(response, gate.setCookie, request.nextUrl.protocol === "https:")
    : response;
}

export const config = {
  matcher: [
    // Gate everything except Next internals and real static-asset requests.
    // The extension alternative is $-anchored: without it, any PAGE whose
    // path merely contains ".js"/".css"/… (e.g. /blog/why.js-rocks) would
    // silently skip the gate. The exact-file exceptions are `\.`-escaped and
    // $-anchored too, so an unanchored `robots.txt` can't prefix-match a page
    // like /robots.txt/secret and leak it. (`_next/static|_next/image` stay
    // directory PREFIXES — that namespace is Next-reserved, no page lives there.)
    // NOTE: excluded assets are PUBLIC. Fine for SSR (they're framework code); if
    // client bundles carry sensitive baked-in data, gate them too — see SKILL.md's
    // "Static assets are public" gotcha.
    "/((?!_next/static|_next/image|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|map|woff2?)$).*)",
  ],
};
