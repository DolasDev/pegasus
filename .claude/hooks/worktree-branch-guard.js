#!/usr/bin/env node
// Worktree Branch Guard — PreToolUse hook (Bash)
// Enforces the "primary checkout stays parked on main" convention.
//
// When an agent tries to switch/create a branch (git checkout <branch>,
// git checkout -b, git switch, git switch -c) *in the primary worktree*,
// this hook DENIES the command and redirects the agent to the
// /workstream-start skill so the work is done in an isolated worktree+branch.
//
// Scope guards (all fail-open — a guard that can't decide never blocks):
//   * Only fires for Bash tool calls.
//   * Only fires in the PRIMARY worktree (git-dir === git-common-dir).
//     Linked worktrees legitimately live on feature branches — left alone.
//   * Only branch-changing forms are blocked. File restores
//     (git checkout -- <file>, git checkout ., git restore) pass through.
//   * Switching back to main/master is always allowed (return to convention).

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
    if (data.tool_name !== 'Bash') process.exit(0);

    const command = data.tool_input?.command || '';
    if (!/\bgit\b/.test(command) || !/\b(checkout|switch)\b/.test(command)) {
      process.exit(0);
    }

    const target = branchSwitchTarget(command);
    if (!target) process.exit(0); // not a branch switch (file restore, etc.)

    // Allow returning to the parked branch.
    if (target === 'main' || target === 'master') process.exit(0);

    const cwd = data.cwd || process.cwd();
    if (!isPrimaryWorktree(cwd)) process.exit(0); // linked worktree — allowed

    // Primary worktree + branch switch away from main → DENY and redirect.
    const reason =
      `⛔ Branch switch blocked on the PRIMARY worktree.\n\n` +
      `This command would move the primary checkout onto \`${target}\`, but by ` +
      `convention the primary checkout stays parked on \`main\` — one stream = one ` +
      `worktree = one branch.\n\n` +
      `To do this work correctly, invoke the **/workstream-start** skill: it provisions ` +
      `an isolated worktree + branch (via scripts/new-worktree.sh) off fresh origin/main, ` +
      `seeds the plan into it, and moves you in to implement. Re-run your git command ` +
      `there, not here.\n\n` +
      `(File restores like \`git checkout -- <file>\` are not affected. If you truly must ` +
      `re-point the primary worktree's branch, do it manually outside this session.)`;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      })
    );
    process.exit(0);
  } catch {
    process.exit(0); // never block on error
  }
});

// Returns the branch/ref target if `command` is a branch-changing git command,
// else null. Handles switch and checkout, skipping file-restore forms.
function branchSwitchTarget(command) {
  // git switch [-c|-C|--create] <branch> | git switch -
  let m = command.match(/\bgit\s+switch\b([^&|;]*)/);
  if (m) {
    const args = m[1].trim();
    if (/(^|\s)(--help|-h)(\s|$)/.test(args)) return null;
    for (const p of args.split(/\s+/).filter(Boolean)) {
      if (p.startsWith('-') && p !== '-') continue; // flag
      return p; // branch name, or '-' (previous branch)
    }
    return null;
  }

  // git checkout [-b|-B|--detach] <branch>  (but not file restores)
  m = command.match(/\bgit\s+checkout\b([^&|;]*)/);
  if (m) {
    const args = m[1].trim();
    if (/(^|\s)(--help|-h)(\s|$)/.test(args)) return null;
    if (/(^|\s)--(\s|$)/.test(args)) return null; // git checkout -- <file>
    for (const p of args.split(/\s+/).filter(Boolean)) {
      if (p === '.') return null; // restore all paths
      if (p.startsWith('-') && p !== '-') continue; // flag (-b, -B, --detach)
      return p; // branch/ref name, or '-' (previous branch)
    }
    return null;
  }

  return null;
}

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
    return false; // not a repo / git error → fail open
  }
}
