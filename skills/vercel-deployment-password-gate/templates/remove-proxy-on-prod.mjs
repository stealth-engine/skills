// Strips the checked-in proxy.ts from PRODUCTION builds on Vercel, so prod
// deployments ship no middleware function at all (zero invocations, zero cost).
// Previews, custom environments, and local dev keep the file; the gate itself
// no-ops on production/development/unset targets.
// Chain it explicitly (pnpm skips npm pre/post hooks by default):
//   "build": "node scripts/remove-proxy-on-prod.mjs && next build"
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const MARKER = "@deploy-gate:managed";
const targetPath = resolve(process.cwd(), "proxy.ts"); // adjust if using src/ or middleware.ts

const isVercelBuild = process.env.VERCEL === "1";
// Use VERCEL_TARGET_ENV: a custom environment can report VERCEL_ENV=production
// while TARGET_ENV is its own name — we must NOT strip the gate from those.
const target = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV;
const isProduction = target === "production";

if (!isVercelBuild || !isProduction) {
  console.log(
    `[deploy-gate] keeping proxy.ts (VERCEL=${process.env.VERCEL ?? "unset"}, target=${target ?? "unset"}, VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`,
  );
  process.exit(0);
}

if (!existsSync(targetPath)) {
  console.log("[deploy-gate] no proxy.ts present — nothing to remove");
  process.exit(0);
}

// Never delete hand-written middleware. If the gate was integrated into a
// custom proxy (Mode A), drop this script from the build chain instead.
if (!readFileSync(targetPath, "utf8").includes(MARKER)) {
  console.warn(
    "[deploy-gate] proxy.ts lacks the @deploy-gate:managed marker — leaving it in place. Production will ship this middleware.",
  );
  process.exit(0);
}

rmSync(targetPath);
console.log(
  "[deploy-gate] removed proxy.ts — production build ships no middleware",
);
