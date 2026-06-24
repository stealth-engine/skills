// normalize-pr-title.js
// Reusable PR-title → Conventional Commits normaliser, called from a
// github-script step (see pr-title-manager.yml). Pure + unit-testable.

const TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore', 'revert',
];

// A valid Conventional Commit header: type(scope)!: subject
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([^)]+\\))?!?: .+`);

// Branch prefix → Conventional type (incl. AI-agent prefixes).
const BRANCH_TYPE = {
  feature: 'feat', feat: 'feat',
  fix: 'fix', bugfix: 'fix', hotfix: 'fix',
  docs: 'docs', chore: 'chore', refactor: 'refactor',
  perf: 'perf', test: 'test', ci: 'ci', build: 'build',
};

const RANK = { feat: 2, fix: 1 }; // highest-impact type wins

function detectTypeFromCommits(commits = []) {
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
    // Already valid — just lowercase the leading type token if needed.
    const fixed = title.replace(/^(\w+)/, (t) => t.toLowerCase());
    return fixed === title
      ? { newTitle: title, changed: false, reason: 'already_valid' }
      : { newTitle: fixed, changed: true, reason: 'case_correction' };
  }

  // Not conventional — synthesise `<type>: <subject>`.
  const type =
    detectTypeFromCommits(commits) || detectTypeFromBranch(branchName) || 'chore';
  const subject = toSubject(title) || 'update';
  return { newTitle: `${type}: ${subject}`, changed: true, reason: 'format_correction' };
}

module.exports = { processPRTitle, TYPES, CONVENTIONAL };
