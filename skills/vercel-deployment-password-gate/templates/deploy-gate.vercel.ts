/* @deploy-gate:managed — scripts/remove-proxy-on-prod.mjs strips this file
 * from Vercel production builds; keep this marker line if you edit the file.
 * (The removal script scans middleware.ts / src/middleware.ts by marker, so no
 * edit is needed for this variant.) */
/**
 * Deployment password gate — FRAMEWORK-AGNOSTIC variant for any project deployed
 * on Vercel (SvelteKit, Nuxt, Astro, Remix, static sites, SPAs, …) via
 * Vercel Routing Middleware. For Next.js apps prefer deploy-gate.ts.
 *
 * Install: place at the project root as `middleware.ts` (next to package.json)
 * and add the one dependency: `npm i @vercel/functions`.
 *
 * Lifecycle, auth scheme, env vars, and cookie semantics are identical to the
 * Next.js variant — see deploy-gate.ts and the skill's SKILL.md. Bypass
 * accepts TOKENS ONLY; the human password unlocks solely via the form.
 * `config.runtime` MUST stay "nodejs" (edge is the default and lacks node:crypto).
 */
import { next } from "@vercel/functions";
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
type GateResult =
  | { action: "pass"; setCookie?: string }
  | { action: "block"; response: Response };

// Env is deployment-constant; memoize so the legacy-plaintext scrypt cost is
// paid once per instance, not per request.
// Absent config fails OPEN; PRESENT-and-malformed fails CLOSED (see SKILL.md).
type GateConfigState = GateConfig | null | "malformed";

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
  // through to "unconfigured → open".
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
// domain (not the path — that's what the matcher/config is for). Comma-separated,
// e.g. DEPLOY_GATE_UNPROTECTED_HOSTS="demo.acme.com, staging.acme.com".
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

function isUnprotectedHost(request: Request, allowlist: string[]): boolean {
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

// Keyed on the stored credential rather than a separate signing secret — a
// separate secret shares the same env-store trust boundary and adds nothing;
// per-credential keying buys instant revocation on rotation.
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

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// `secure` gates the `Secure` attribute: every real Vercel deployment is https,
// but a plain-http origin (the documented `http://localhost` local test) may
// drop a Secure cookie and never persist the unlock. Callers pass
// `url.protocol === "https:"`.
function cookieHeader(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
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
  request: Request,
  url: URL,
  tokens: BypassTokens,
): { cookieValue: string; viaQuery: boolean } | null {
  const candidates: Array<[string | null, boolean]> = [
    [request.headers.get(BYPASS_PARAM), false],
    [url.searchParams.get(BYPASS_PARAM), true],
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

function htmlResponse(html: string, status = 401): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function redirectResponse(location: string, setCookie: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "set-cookie": setCookie, "cache-control": "no-store" },
  });
}

export async function previewGate(request: Request): Promise<GateResult> {
  // Gate every remote non-production Vercel deployment: `preview` AND any
  // custom environment (e.g. a named "staging"). Never gate production (also
  // stripped from prod builds), local dev, or non-Vercel hosts.
  // Key off VERCEL_TARGET_ENV, not VERCEL_ENV: VERCEL_ENV only ever reports
  // production/preview/development, collapsing every custom environment into
  // one of those buckets, so a custom target (e.g. "staging") could read
  // VERCEL_ENV=production and slip through ungated. VERCEL_TARGET_ENV carries
  // the custom name; fall back to VERCEL_ENV when it's absent (older Vercel,
  // non-Vercel, local). Gate every remote target except production.
  const target = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV;
  // Never gate true production, or a Vercel `development` target (`vercel dev`).
  if (target === "production" || target === "development") return { action: "pass" };

  // Local dev server: no Vercel target AND NODE_ENV=development. Dev servers set
  // NODE_ENV=development; a Vercel deployment always runs NODE_ENV=production —
  // including a preview with "System Environment Variables" disabled, the only
  // other case where target reads `undefined`. NODE_ENV is NOT toggle-gated, so
  // it's readable when the VERCEL_* vars are hidden. Keeps local dev ungated
  // even with preview creds pulled, WITHOUT ungating a real preview. The
  // documented local-test flow sets VERCEL_TARGET_ENV=preview, so the gate runs.
  if (target === undefined && process.env.NODE_ENV === "development") return { action: "pass" };

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
  if (configState === null && tokens.absent && !hostsDeclared) return { action: "pass" };

  // Deployment Protection Exceptions equivalent: an explicitly listed host is
  // public. Honored BEFORE the malformed 503 so an exception survives a bad
  // hash — but ONLY when target is a known Vercel env: the check trusts the Host
  // header, safe only because Vercel's edge routes on it. When target is
  // undefined (env hidden, or off-Vercel) Host is spoofable, so skip it.
  if (target !== undefined && isUnprotectedHost(request, hosts)) return { action: "pass" };

  // Present-but-unusable config → fail closed. Malformed hash / over-long legacy
  // password; unusable token JSON when tokens are the SOLE credential; OR a
  // host-exception list declared with NO password/token to gate the other hosts
  // (reaching here with config null + tokens absent means hosts were declared).
  if (
    configState === "malformed" ||
    (configState === null && tokens.malformed) ||
    (configState === null && tokens.absent)
  ) {
    return {
      action: "block",
      response: new Response(
        "Deployment gate misconfigured — DEPLOY_GATE_PASSWORD_HASH is not a valid s2 hash, DEPLOY_GATE_PASSWORD exceeds the maximum length, DEPLOY_GATE_BYPASS_TOKENS yielded no usable tokens, or DEPLOY_GATE_UNPROTECTED_HOSTS is set with no password/token to gate the other hosts.",
        { status: 503, headers: { "cache-control": "no-store" } },
      ),
    };
  }
  const config = configState;

  const url = new URL(request.url);
  const cookie = getCookie(request, COOKIE_NAME);
  if (cookie && validCookieValues(config, tokens.map).some((v) => safeEqual(cookie, v))) {
    return { action: "pass" };
  }

  const bypass = matchBypass(request, url, tokens.map);
  if (bypass) {
    if (bypass.viaQuery) {
      const cleanUrl = new URL(url);
      cleanUrl.searchParams.delete(BYPASS_PARAM); // removes ALL occurrences
      return {
        action: "block",
        response: redirectResponse(cleanUrl.toString(), cookieHeader(bypass.cookieValue, url.protocol === "https:")),
      };
    }
    return { action: "pass", setCookie: cookieHeader(bypass.cookieValue, url.protocol === "https:") };
  }

  if (!config) {
    return {
      action: "block",
      response: new Response("Locked — automation bypass required.", {
        status: 401,
        headers: { "cache-control": "no-store" },
      }),
    };
  }

  if (request.method === "POST" && url.pathname === UNLOCK_PATH) {
    const form = await request.formData().catch(() => null);
    const attempt = form?.get("password");
    const returnPath = sanitizeReturnPath(url.searchParams.get("from"));
    if (
      typeof attempt === "string" &&
      attempt.length > 0 &&
      attempt.length <= MAX_PASSWORD_LENGTH &&
      verifyPassword(config, attempt)
    ) {
      return {
        action: "block",
        response: redirectResponse(
          new URL(returnPath, url).toString(),
          cookieHeader(mintCookie(config.hash, "unlocked"), url.protocol === "https:"),
        ),
      };
    }
    return { action: "block", response: htmlResponse(unlockFormHtml(returnPath, true)) };
  }

  return {
    action: "block",
    response: htmlResponse(unlockFormHtml(sanitizeReturnPath(url.pathname + url.search), false)),
  };
}

export default async function middleware(request: Request) {
  const result = await previewGate(request);
  if (result.action === "block") return result.response;
  // Strip the bypass token before forwarding upstream, so app code / request
  // logging never sees it (the query-param path strips it from the URL). Always
  // safe — the header only means something to the gate.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(BYPASS_PARAM);
  return next({
    request: { headers: requestHeaders },
    ...(result.setCookie ? { headers: { "set-cookie": result.setCookie } } : {}),
  });
}

export const config = {
  runtime: "nodejs", // REQUIRED: edge is the default and lacks node:crypto
  matcher: [
    // Gate every route except real static-asset requests, matched by file
    // EXTENSION and $-anchored (so a PAGE whose path merely contains ".js" —
    // e.g. /blog/why.js-rocks — is still gated, not skipped). The exact-file
    // exceptions are likewise `\.`-escaped and $-anchored: an UNanchored
    // `robots.txt` would prefix-match a page like /robots.txt/secret (or, with
    // the dot unescaped, /robotsXtxt) and leak it. Framework-neutral on purpose:
    // hashed build output (SvelteKit /_app, Nuxt /_nuxt, Astro /_astro, Remix
    // /build, Vite /assets) is *.js / *.css, already covered by the extension
    // rule — so there are NO Next-specific `_next/*` entries here (this is the
    // non-Next template). To make other internal paths public, add an anchored
    // entry to the negative lookahead (e.g. `_nuxt/` for a directory prefix).
    //
    // ⚠️ SECURITY — excluded assets are PUBLIC (they never run the gate). For an
    // SSR app that's fine (JS/CSS is framework code). But a **static site or SPA
    // often bakes its content/data into the hashed JS bundle** — with this
    // matcher, anyone who learns an asset URL fetches that content WITHOUT the
    // password. If the material in your bundles is sensitive, gate everything:
    // replace the line below with `"/((?!favicon\\.ico$).*)"` (keeps only the
    // tab icon public) and inline the unlock page's logo as a data URI, since a
    // same-origin logo would then be gated too. The per-request cost is just a
    // cookie compare (scrypt runs only on the unlock POST). See SKILL.md's
    // "Static assets are public" gotcha.
    "/((?!favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|mjs|map|woff2?)$).*)",
  ],
};
