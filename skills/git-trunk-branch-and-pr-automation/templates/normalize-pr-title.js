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

const RANK = { feat: 2, fix: 1 }; // highest-impact type wins

function detectTypeFromCommits(commits = []) {
  if (!Array.isArray(commits)) return null;
  let best = null;
  for (const c of commits) {
    const msg = c.commit?.message || c.message || '';
    const m = msg.match(/^(\w+)(\([^)]+\))?!?:/);
    if (!m) continue;
    const t = m[1].toLowerCase();
    if (!TYPES.includes(t)) continue;
    if (best === null || (RANK[t] || 0) > (RANK[best] || 0)) best = t;
  }
  return best;
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

  if (CONVENTIONAL.test(title)) {
    return { newTitle: title, changed: false, reason: 'already_valid' };
  }

  // Conventional except for the type's casing ("Feat: …") → just lowercase the type.
  if (CONVENTIONAL_I.test(title)) {
    const fixed = title.replace(/^([A-Za-z]+)/, (t) => t.toLowerCase());
    return { newTitle: fixed, changed: true, reason: 'case_correction' };
  }

  // Not conventional — synthesise `<type>: <subject>`. Strip any leading
  // "word(scope)!: " first so we never double-prefix (e.g. "WIP: foo", "Update: x").
  const type =
    detectTypeFromCommits(commits) || detectTypeFromBranch(branchName) || 'chore';
  // Strip ONLY a leading real-type prefix (case-insensitive) so a mis-cased
  // "Feat: x" doesn't double-prefix, while a descriptive "Note: x" keeps its text.
  const stripped = title.replace(
    new RegExp(`^(${TYPES.join('|')})(\\([^)]+\\))?!?:\\s*`, 'i'),
    ''
  );
  const subject = toSubject(stripped || title) || 'update';
  return { newTitle: `${type}: ${subject}`, changed: true, reason: 'format_correction' };
}

module.exports = { processPRTitle, TYPES, CONVENTIONAL };
