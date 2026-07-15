#!/usr/bin/env node
// Worktree Guard Notice — SessionStart hook
// When a session starts in the PRIMARY worktree, inject a short note so the
// agent knows branch switches are blocked here and that feature work goes
// through /workstream-start. Emits nothing in linked worktrees (the branch
// guard doesn't fire there, so the note would be noise).
//
// Pairs with .claude/hooks/worktree-branch-guard.js (the enforcing PreToolUse hook).

const { execFileSync } = require('child_process');
const path = require('path');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();
    if (!isPrimaryWorktree(cwd)) process.exit(0); // linked worktree — stay quiet

    const note =
      `📍 PRIMARY worktree — this checkout stays parked on \`main\`. ` +
      `Branch switches/creates here (git checkout <branch>, checkout -b, switch, switch -c) ` +
      `are BLOCKED by a PreToolUse guard. For any feature/fix work, use the ` +
      `**/workstream-start** skill to provision an isolated worktree + branch and implement ` +
      `there. File restores (git checkout -- <file>) and returning to main are unaffected.`;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: note,
        },
      })
    );
    process.exit(0);
  } catch {
    process.exit(0); // never disrupt session start on error
  }
});

// True when cwd is the primary worktree (git-dir === git-common-dir).
function isPrimaryWorktree(cwd) {
  try {
    const out = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--git-dir', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const [gitDir, commonDir] = out.trim().split('\n');
    if (!gitDir || !commonDir) return false;
    return path.resolve(cwd, gitDir) === path.resolve(cwd, commonDir);
  } catch {
    return false; // not a repo / git error → stay quiet
  }
}
