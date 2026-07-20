// Strips the checked-in proxy.ts from PRODUCTION builds on Vercel, so prod
// deployments ship no middleware function at all (zero invocations, zero cost).
// Previews, custom environments, and local dev keep the file; the gate itself
// no-ops on production/development/unset targets.
// Chain it explicitly (pnpm skips npm pre/post hooks by default):
//   "build": "node scripts/remove-proxy-on-prod.mjs && next build"
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const MARKER = "@deploy-gate:managed";
// Every layout the gate can be installed in: Next root/src `proxy.ts`, and the
// framework-agnostic `middleware.ts` (root/src). We only ever delete a file
// carrying the MARKER, so scanning all of them can't touch hand-written
// middleware. Add your path here if the gate lives somewhere custom.
const CANDIDATES = ["proxy.ts", "src/proxy.ts", "middleware.ts", "src/middleware.ts"];

const isVercelBuild = process.env.VERCEL === "1";
// Use VERCEL_TARGET_ENV: a custom environment can report VERCEL_ENV=production
// while TARGET_ENV is its own name — we must NOT strip the gate from those.
const target = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV;
const isProduction = target === "production";

if (!isVercelBuild || !isProduction) {
  console.log(
    `[deploy-gate] keeping the gate (VERCEL=${process.env.VERCEL ?? "unset"}, target=${target ?? "unset"}, VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`,
  );
  process.exit(0);
}

// Delete only files carrying the managed marker — never hand-written middleware.
const managed = CANDIDATES.map((p) => resolve(process.cwd(), p)).filter(
  (p) => existsSync(p) && readFileSync(p, "utf8").includes(MARKER),
);

if (managed.length === 0) {
  // Loud, not silent: a quiet exit here reads as "stripped OK" when in fact the
  // gate file lives at an unscanned path and WILL ship to production (it no-ops
  // there, so it's a cost regression, not a security hole — but say so).
  console.warn(
    `[deploy-gate] no @deploy-gate:managed file found at any of: ${CANDIDATES.join(", ")}. ` +
      "If the gate lives elsewhere, add its path to CANDIDATES. Production will " +
      "ship whatever middleware exists (the gate no-ops in production, so this " +
      "only forfeits the zero-cost property).",
  );
  process.exit(0);
}

for (const p of managed) rmSync(p);
console.log(
  `[deploy-gate] removed ${managed.length} managed file(s) — production build ships no gate middleware`,
);
