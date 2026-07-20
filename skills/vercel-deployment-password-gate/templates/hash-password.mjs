// Hashes a plaintext gate password into the DEPLOY_GATE_PASSWORD_HASH format
// (`s2:<salt>:<scryptHex>`) used by deploy-gate.ts. scrypt (memory-hard KDF),
// not plain SHA-256 — CodeQL js/insufficient-password-hash flagged the earlier
// salted-SHA-256 scheme in a real install (2026-07-17).
// Usage:
//   node hash-password.mjs                # prompts on stdin (keeps it out of shell history)
//   node hash-password.mjs '<plaintext>'  # argv — beware shell history
// Prints ONLY the hash on stdout, so it pipes cleanly:
//   node hash-password.mjs | vercel env add DEPLOY_GATE_PASSWORD_HASH preview
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
  const isTty = rl.terminal;
  rl.question("Deploy-gate password: ", (password) => {
    rl.close();
    // In a TTY the muted _writeToOutput also swallowed the Enter keypress —
    // print the newline so the shell prompt lands on its own line.
    if (isTty) process.stderr.write("\n");
    assertUsable(password);
    console.log(hash(password));
  });
  // Mute echo AFTER question() has painted the prompt (getpass-style). In a
  // TTY, readline does its own keystroke echo; blanking _writeToOutput keeps
  // the typed password off the screen and out of screen recordings. Piped
  // (non-TTY) input isn't echoed anyway, so this is a no-op there.
  // `_writeToOutput` is an underscore-internal but decade-stable Node API — the
  // standard no-deps recipe; if a future Node breaks it, the password would
  // echo (visible-but-still-not-logged), not fail.
  if (isTty) rl._writeToOutput = () => {};
}
