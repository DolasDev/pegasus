#!/usr/bin/env node
// Override-expiry detector (deterministic stage — no AI).
//
// For each key in the root package.json `overrides`, decide whether the override
// still does anything. The reliable, mechanical signal is npm's own resolution:
// `npm ls --all --json` marks every node whose version was forced by an override
// with `"overridden": true`. So:
//
//   - package absent from the installed tree  -> override is DEAD (dep gone)
//   - package present, NO node marked overridden -> override is INERT (natural
//     resolution already satisfies the pin; the constraint is doing nothing)
//   - package present with >=1 overridden node -> override is ACTIVE (keep)
//
// INERT and DEAD overrides are removal *candidates* — the judgement call (re-run
// the affected suite, read the tracking plan, actually delete + re-resolve) is the
// second stage and is intentionally left to a human/agent. This script only
// surfaces candidates; it never edits package.json.
//
// Usage: node scripts/check-overrides.mjs [--report <path>]
// Exit 0 always (a monthly workflow files an issue from the report; a non-empty
// report is a signal, not a failure).

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

// Collect the set of package names targeted by overrides. Handles both the
// simple form ("pkg": "1.2.3") and the nested form ("parent": { "child": "x" }).
function collectTargets(overrides) {
  const targets = new Set();
  for (const [key, value] of Object.entries(overrides ?? {})) {
    // A key starting with a version range (e.g. "foo@1") still names a package.
    const name = key.includes('@', 1) ? key.slice(0, key.lastIndexOf('@')) : key;
    if (typeof value === 'string') {
      targets.add(name);
    } else if (value && typeof value === 'object') {
      // Nested override: the parent constrains its children; the children are the
      // packages actually forced. Record both so neither is missed.
      targets.add(name);
      for (const child of Object.keys(value)) {
        if (child !== '.') targets.add(child);
      }
    }
  }
  return targets;
}

const targets = collectTargets(pkg.overrides);

// `npm ls` exits non-zero on extraneous/peer issues even when the tree prints —
// capture stdout regardless of exit code.
let tree;
try {
  const out = execSync('npm ls --all --json', {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  tree = JSON.parse(out);
} catch (err) {
  if (err.stdout) {
    tree = JSON.parse(err.stdout);
  } else {
    console.error('Failed to run `npm ls --all --json`:', err.message);
    process.exit(0);
  }
}

// Walk the dependency tree, recording for each target package name whether any
// instance was overridden and the versions seen.
const seen = new Map(); // name -> { overridden: bool, versions: Set }

function visit(node) {
  const deps = node.dependencies ?? {};
  for (const [name, child] of Object.entries(deps)) {
    if (targets.has(name)) {
      const rec = seen.get(name) ?? { overridden: false, versions: new Set() };
      if (child.version) rec.versions.add(child.version);
      if (child.overridden) rec.overridden = true;
      seen.set(name, rec);
    }
    visit(child);
  }
}
visit(tree);

const dead = [];
const inert = [];
const active = [];

for (const name of [...targets].sort()) {
  const rec = seen.get(name);
  if (!rec) {
    dead.push(name);
  } else if (!rec.overridden) {
    inert.push({ name, versions: [...rec.versions] });
  } else {
    active.push({ name, versions: [...rec.versions] });
  }
}

const candidates = dead.length + inert.length;
const lines = [];
lines.push(`# Override-expiry report`);
lines.push('');
lines.push(
  `Checked ${targets.size} override target(s) against the installed tree. ` +
    `**${candidates} removal candidate(s)** found.`,
);
lines.push('');

if (dead.length) {
  lines.push(`## Dead — package no longer in the tree (${dead.length})`);
  lines.push('');
  lines.push('The override targets a package nothing depends on anymore. Safe to delete.');
  lines.push('');
  for (const name of dead) lines.push(`- \`${name}\``);
  lines.push('');
}

if (inert.length) {
  lines.push(`## Inert — override forces nothing (${inert.length})`);
  lines.push('');
  lines.push(
    'The package is installed but no instance is marked `overridden` — the override ' +
      'changes no currently-installed version. It is a removal *candidate*, not a ' +
      'safe delete: removing it lets the resolver run unconstrained, which can pull a ' +
      'lower version a parent range still permits. Confirm by deleting the entry, ' +
      '`rm -rf node_modules package-lock.json && npm install`, then running the ' +
      'affected suite before committing.',
  );
  lines.push('');
  for (const { name, versions } of inert) {
    lines.push(`- \`${name}\` — installed: ${versions.join(', ') || 'unknown'}`);
  }
  lines.push('');
}

if (!candidates) {
  lines.push('All overrides are active (forcing a version). Nothing to remove.');
  lines.push('');
}

if (active.length) {
  lines.push(`<details><summary>Active overrides — keep (${active.length})</summary>`);
  lines.push('');
  for (const { name, versions } of active) {
    lines.push(`- \`${name}\` — ${versions.join(', ')}`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');
}

const report = lines.join('\n');

const reportFlag = process.argv.indexOf('--report');
if (reportFlag !== -1 && process.argv[reportFlag + 1]) {
  if (candidates > 0) {
    writeFileSync(process.argv[reportFlag + 1], report);
  }
  // Leave the file absent/empty when there are no candidates so the workflow's
  // `[ -s report ]` test files an issue only when there is something to act on.
}

console.log(report);
process.exit(0);
