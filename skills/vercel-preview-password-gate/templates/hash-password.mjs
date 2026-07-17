// Hashes a plaintext preview password into the PREVIEW_PASSWORD_HASH format
// (`s2:<salt>:<scryptHex>`) used by preview-gate.ts. scrypt (memory-hard KDF),
// not plain SHA-256 — CodeQL js/insufficient-password-hash flagged the earlier
// salted-SHA-256 scheme in a real install (2026-07-17).
// Usage:
//   node hash-password.mjs                # prompts on stdin (keeps it out of shell history)
//   node hash-password.mjs '<plaintext>'  # argv — beware shell history
// Prints ONLY the hash on stdout, so it pipes cleanly:
//   node hash-password.mjs | vercel env add PREVIEW_PASSWORD_HASH preview
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

// Must match MAX_PASSWORD_LENGTH in the gate templates — the gate rejects
// longer submissions, so a longer password here would hash fine but never unlock.
const MAX_PASSWORD_LENGTH = 256;

function assertUsable(password) {
  if (!password) {
    console.error("empty password");
    process.exit(1);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    console.error(
      `password longer than ${MAX_PASSWORD_LENGTH} chars — the gate caps submissions there and would never accept it`,
    );
    process.exit(1);
  }
}

function hash(password) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `s2:${salt}:${digest}`;
}

const fromArgv = process.argv[2];
if (fromArgv !== undefined) {
  assertUsable(fromArgv);
  console.log(hash(fromArgv));
} else {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  rl.question("Preview password: ", (password) => {
    rl.close();
    assertUsable(password);
    console.log(hash(password));
  });
}
