// Manages named automation bypass tokens for DEPLOY_GATE_BYPASS_TOKENS
// (JSON: {"<label>":"<token>", ...}). Pure and local: current JSON in, new
// JSON out — the agent glues it to `vercel env rm`/`add`.
// Usage:
//   node bypass-tokens.mjs add <label> ['<current-json>']   # generates a URL-safe token
//   node bypass-tokens.mjs remove <label> '<current-json>'
//   node bypass-tokens.mjs list '<current-json>'
// stdout = the new JSON (pipe into `vercel env add DEPLOY_GATE_BYPASS_TOKENS preview`)
// stderr = human-readable summary (including the newly generated token)
import { randomBytes } from "node:crypto";

const [, , command, arg1, arg2] = process.argv;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseTokens(raw) {
  if (raw === undefined || raw.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("current JSON is malformed — fix or pass the exact current env value");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("current JSON must be an object of label → token");
  }
  return parsed;
}

switch (command) {
  case "add": {
    const label = arg1;
    const tokens = parseTokens(arg2);
    if (!label || !/^[a-z0-9][a-z0-9_-]*$/i.test(label)) {
      fail("add requires a label matching [a-z0-9_-] (e.g. ci, lighthouse, uptime)");
    }
    // Object.hasOwn, not truthiness/`in`: inherited names like "constructor"
    // or "toString" would otherwise false-positive as existing labels.
    if (Object.hasOwn(tokens, label)) {
      fail(`label "${label}" already exists — remove it first to rotate it`);
    }
    // base64url → URL-safe, so the token works in the query parameter too.
    const token = randomBytes(18).toString("base64url");
    tokens[label] = token;
    console.error(`added "${label}": ${token}`);
    console.log(JSON.stringify(tokens));
    break;
  }
  case "remove": {
    const label = arg1;
    const tokens = parseTokens(arg2);
    if (!label || !Object.hasOwn(tokens, label)) {
      fail(`label "${label ?? ""}" not found — labels: ${Object.keys(tokens).join(", ") || "(none)"}`);
    }
    delete tokens[label];
    console.error(`removed "${label}" (${Object.keys(tokens).length} remaining)`);
    console.log(JSON.stringify(tokens));
    break;
  }
  case "list": {
    const tokens = parseTokens(arg1);
    const entries = Object.entries(tokens);
    if (entries.length === 0) console.error("(no bypass tokens)");
    for (const [label, token] of entries) console.error(`${label}: ${token}`);
    break;
  }
  default:
    fail("usage: bypass-tokens.mjs add <label> ['<json>'] | remove <label> '<json>' | list '<json>'");
}
