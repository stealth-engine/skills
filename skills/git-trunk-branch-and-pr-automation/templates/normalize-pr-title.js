// normalize-pr-title.js
// Reusable PR-title → Conventional Commits normaliser, called from a
// github-script step (see pr-title-manager.yml). Pure + unit-testable.

const TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore', 'revert',
];

// A valid Conventional Commit header: type(scope)!: subject
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([^)]+\\))?!?: .+`);
// Case-insensitive variant — to detect a title that IS conventional but mis-cased
// (e.g. "Feat: …"), so we just fix the case instead of double-prefixing it.
const CONVENTIONAL_I = new RegExp(`^(${TYPES.join('|')})(\\([^)]+\\))?!?: .+`, 'i');

// Human branch prefix → Conventional type. NOTE: agent/bot prefixes (claude/,
// cursor/, codex/, codegen-bot/, copilot/, dependabot/) are intentionally NOT here
// — their type comes from the PR's (conventional) commits; the branch prefix is
// only a last-resort fallback.
const BRANCH_TYPE = {
  feature: 'feat', feat: 'feat',
  fix: 'fix', bugfix: 'fix', hotfix: 'fix',
  docs: 'docs', chore: 'chore', refactor: 'refactor',
  perf: 'perf', test: 'test', ci: 'ci', build: 'build',
};

const RANK = { feat: 2, fix: 1, perf: 1 }; // release-signalling types; others = 0 (no release)

// Returns the strongest release-signalling type across the commits, plus whether
// any commit is breaking (`!` or a `BREAKING CHANGE`/`BREAKING-CHANGE` footer) — so
// the synthesised title can carry the `!` and not under-release after squash.
function detectFromCommits(commits = []) {
  if (!Array.isArray(commits)) return { type: null, scope: null, breaking: false };
  let best = null;
  let bestScope = null;
  let bestRank = -1;
  let breaking = false;
  for (const c of commits) {
    const msg = c.commit?.message || c.message || '';
    const m = msg.match(/^(\w+)(?:\(([^)]+)\))?(!)?:/);
    const isBreaking = (m && m[3] === '!') || /^BREAKING[ -]CHANGE:/m.test(msg);
    if (isBreaking) breaking = true;
    if (m) {
      const t = m[1].toLowerCase();
      if (TYPES.includes(t)) {
        // Rank breaking commits highest so type+scope+`!` all come from the SAME
        // (strongest) commit — else a breaking `fix(api)!:` could mis-attribute the
        // `!` to a higher-type-but-non-breaking `feat(ui):` scope.
        const rank = (isBreaking ? 100 : 0) + (RANK[t] || 0);
        if (rank > bestRank) {
          bestRank = rank;
          best = t;
          bestScope = m[2] || null;
        }
      }
    }
  }
  return { type: best, scope: bestScope, breaking };
}

function detectTypeFromBranch(branchName = '') {
  const prefix = branchName.split('/')[0].toLowerCase();
  return BRANCH_TYPE[prefix] || null;
}

function toSubject(s) {
  s = s.trim().replace(/[.\s]+$/, ''); // drop trailing period/space
  if (s) s = s[0].toLowerCase() + s.slice(1); // conventional: lowercase start
  return s;
}

/**
 * @returns {{ newTitle: string, changed: boolean, reason: string }}
 */
function processPRTitle(currentTitle, commits = [], branchName = '') {
  const title = (currentTitle || '').trim();
  const det = detectFromCommits(commits);

  // Inject the breaking `!` if commits signal a breaking change but the header
  // doesn't already — else a `feat!:` commit under an `feat: …` title would
  // under-release (minor instead of major) after squash.
  const withBreaking = (header) => {
    if (!det.breaking || /^[A-Za-z]+(\([^)]+\))?!:/.test(header)) return header;
    return header.replace(/^([A-Za-z]+(?:\([^)]+\))?)\s*:/, '$1!:');
  };

  if (CONVENTIONAL.test(title)) {
    const fixed = withBreaking(title);
    return fixed === title
      ? { newTitle: title, changed: false, reason: 'already_valid' }
      : { newTitle: fixed, changed: true, reason: 'breaking_marker' };
  }

  // Conventional except for the type's casing ("Feat: …") → lowercase the type.
  if (CONVENTIONAL_I.test(title)) {
    const fixed = withBreaking(title.replace(/^([A-Za-z]+)/, (t) => t.toLowerCase()));
    return { newTitle: fixed, changed: true, reason: 'case_correction' };
  }

  // Not conventional — synthesise `<type>: <subject>`. Strip any leading
  // "word(scope)!: " first so we never double-prefix (e.g. "WIP: foo", "Update: x").
  const type = det.type || detectTypeFromBranch(branchName) || 'chore';
  const scope = det.scope ? `(${det.scope})` : ''; // keep package scope for monorepos
  const bang = det.breaking ? '!' : ''; // preserve breaking signal → major bump
  // Strip ONLY a leading real-type prefix (case-insensitive) so a mis-cased
  // "Feat: x" doesn't double-prefix, while a descriptive "Note: x" keeps its text.
  const stripped = title.replace(
    new RegExp(`^(${TYPES.join('|')})(\\([^)]+\\))?!?:\\s*`, 'i'),
    ''
  );
  const subject = toSubject(stripped || title) || 'update';
  return {
    newTitle: `${type}${scope}${bang}: ${subject}`,
    changed: true,
    reason: 'format_correction',
  };
}

module.exports = { processPRTitle, TYPES, CONVENTIONAL };
