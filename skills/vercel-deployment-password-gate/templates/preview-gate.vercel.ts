/* @deploy-gate:managed — scripts/remove-proxy-on-prod.mjs strips this file
 * from Vercel production builds; keep this marker line if you edit the file.
 * (Point the removal script's targetPath at middleware.ts for this variant.) */
/**
 * Preview password gate — FRAMEWORK-AGNOSTIC variant for any project deployed
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
  const stored = readGateEnv("DEPLOY_GATE_PASSWORD_HASH")?.trim();
  if (stored) {
    const match = /^s2:([0-9a-f]+):([0-9a-f]{64})$/i.exec(stored);
    if (match) return { salt: match[1], hash: match[2].toLowerCase() };
    console.warn("[deploy-gate] DEPLOY_GATE_PASSWORD_HASH is malformed — failing closed");
    return "malformed";
  }
  const plain = readGateEnv("DEPLOY_GATE_PASSWORD");
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

function bypassTokens(): BypassTokens {
  const raw = readGateEnv("DEPLOY_GATE_BYPASS_TOKENS")?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const tokens: BypassTokens = {};
      for (const [label, token] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof token === "string" && token.length > 0) tokens[label] = token;
      }
      return tokens;
    }
  } catch {
    // fall through to the warning
  }
  console.warn("[deploy-gate] DEPLOY_GATE_BYPASS_TOKENS is malformed JSON — ignoring");
  return {};
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

function isUnprotectedHost(request: Request): boolean {
  const allowlist = unprotectedHosts();
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

function cookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
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
<title>Preview — locked</title>
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
  <h1>Preview deployment</h1>
  ${failed ? '<p class="err">Wrong password — try again.</p>' : ""}
  <input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password" />
  <button type="submit">Unlock preview</button>
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
  if (
    target === undefined ||
    target === "production" ||
    target === "development"
  ) {
    return { action: "pass" };
  }

  // Deployment Protection Exceptions equivalent: an explicitly listed host is
  // public. Checked before config so an exception holds even while the gate is
  // misconfigured (fail-closed 503 below would otherwise take the domain down).
  if (isUnprotectedHost(request)) return { action: "pass" };

  const configState = gateConfig();
  const tokens = bypassTokens();
  if (configState === "malformed") {
    return {
      action: "block",
      response: new Response(
        "Preview gate misconfigured — DEPLOY_GATE_PASSWORD_HASH is not a valid s2 hash, or DEPLOY_GATE_PASSWORD exceeds the maximum length.",
        { status: 503, headers: { "cache-control": "no-store" } },
      ),
    };
  }
  const config = configState;
  if (!config && Object.keys(tokens).length === 0) return { action: "pass" };

  const url = new URL(request.url);
  const cookie = getCookie(request, COOKIE_NAME);
  if (cookie && validCookieValues(config, tokens).some((v) => safeEqual(cookie, v))) {
    return { action: "pass" };
  }

  const bypass = matchBypass(request, url, tokens);
  if (bypass) {
    if (bypass.viaQuery) {
      const cleanUrl = new URL(url);
      cleanUrl.searchParams.delete(BYPASS_PARAM); // removes ALL occurrences
      return {
        action: "block",
        response: redirectResponse(cleanUrl.toString(), cookieHeader(bypass.cookieValue)),
      };
    }
    return { action: "pass", setCookie: cookieHeader(bypass.cookieValue) };
  }

  if (!config) {
    return {
      action: "block",
      response: new Response("Preview locked — automation bypass required.", {
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
          cookieHeader(mintCookie(config.hash, "unlocked")),
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
  return result.setCookie
    ? next({ headers: { "set-cookie": result.setCookie } })
    : next();
}

export const config = {
  runtime: "nodejs", // REQUIRED: edge is the default and lacks node:crypto
  matcher: [
    // Gate everything except framework internals and real static-asset
    // requests. The extension alternative is $-anchored: without it, any PAGE
    // whose path merely contains ".js"/".css"/… (e.g. /blog/why.js-rocks)
    // would silently skip the gate.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|map|txt|xml|woff2?)$).*)",
  ],
};
