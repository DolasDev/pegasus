#!/usr/bin/env node
/*
 * The Alloy gate — `npm run alloy`.
 *
 * Runs every `.als` in this directory through the analyzer headless and compares each command's
 * result against the `expect` written beside it in the source. A mismatch is a **finding**, and the
 * runner exits non-zero for one, because that is the only thing that makes this a gate: an
 * expectation transcribed from the binding layer and refuted by the analyzer is exactly the
 * evidence these specs exist to produce.
 *
 * How to read a red run:
 *
 *   - `check A expect 0` that comes back SAT  — a counterexample exists to something a document
 *     asserts. Read the comment above the assertion; it names the section.
 *   - `run P expect 1` that comes back UNSAT  — a state a document requires cannot be constructed.
 *     Same: the comment names the section that requires it.
 *
 * Neither is a bug in the spec to be coded around. When the binding layer is revised, whoever
 * revises it flips the `expect` and the gate goes green; until then the redness *is* the report.
 *
 * Every command must carry an explicit `expect`. A command without one is a defect the runner
 * fails on, because an unstated expectation cannot be refuted.
 *
 * The analyzer jar is a tool, not evidence: it lives in `.tools/`, which is git-ignored. Pass
 * `--no-fetch` (or set `ALLOY_NO_FETCH=1`) to fail instead of downloading it, and `ALLOY_JAR` to
 * point at a copy you already have.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Pinned. An analyzer that drifts under the specs would make a green run mean nothing. */
const ALLOY_VERSION = '6.2.0'
const ALLOY_URL = `https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v${ALLOY_VERSION}/org.alloytools.alloy.dist.jar`
const ALLOY_SHA256 = '6b8c1cb5bc93bedfc7c61435c4e1ab6e688a242dc702a394628d9a9801edb78d'

const argv = new Set(process.argv.slice(2))
const noFetch = argv.has('--no-fetch') || process.env.ALLOY_NO_FETCH === '1'

const red = (s) => `[31m${s}[0m`
const green = (s) => `[32m${s}[0m`
const dim = (s) => `[2m${s}[0m`
const bold = (s) => `[1m${s}[0m`

function die(message) {
  console.error(`\n${red('alloy:')} ${message}\n`)
  process.exit(2)
}

/* ------------------------------------------------------------------------------------------- *
 * The analyzer
 * ------------------------------------------------------------------------------------------- */

function requireJava() {
  const probe = spawnSync('java', ['-version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    die('java not found on PATH. The analyzer needs a JRE (Java 21 is what these specs were run on).')
  }
}

async function ensureJar() {
  if (process.env.ALLOY_JAR) {
    const named = resolve(process.env.ALLOY_JAR)
    if (!existsSync(named)) die(`ALLOY_JAR points at ${named}, which does not exist.`)
    return named
  }
  const jar = join(here, '.tools', 'org.alloytools.alloy.dist.jar')
  if (existsSync(jar)) {
    const actual = createHash('sha256').update(readFileSync(jar)).digest('hex')
    if (actual !== ALLOY_SHA256) {
      die(
        `${jar}\n  has sha256 ${actual}\n  expected    ${ALLOY_SHA256} (Alloy ${ALLOY_VERSION}).\n` +
          '  Delete it and re-run to fetch the pinned build.',
      )
    }
    return jar
  }
  if (noFetch) die(`${jar} is missing and --no-fetch was given.\n  Fetch it from ${ALLOY_URL}`)

  console.log(dim(`alloy: fetching the pinned analyzer (${ALLOY_VERSION}) into .tools/ …`))
  const response = await fetch(ALLOY_URL)
  if (!response.ok) die(`could not download the analyzer: HTTP ${response.status} from ${ALLOY_URL}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== ALLOY_SHA256) die(`downloaded analyzer has sha256 ${actual}, expected ${ALLOY_SHA256}`)
  mkdirSync(join(here, '.tools'), { recursive: true })
  writeFileSync(jar, bytes)
  return jar
}

/* ------------------------------------------------------------------------------------------- *
 * The expectations, read from the source rather than from the analyzer
 *
 * The analyzer prints `expects=N` only when a command disagrees with its own annotation, so the
 * declared expectation is parsed here too: a run has to be able to say what was expected, not only
 * that something was unexpected.
 * ------------------------------------------------------------------------------------------- */

const COMMAND_RE = /^\s*(run|check)\s+([A-Za-z_][A-Za-z0-9_]*)\b([^\n]*)$/gm

function declaredCommands(source) {
  const commands = new Map()
  for (const [, kind, name, rest] of source.matchAll(COMMAND_RE)) {
    const expect = /\bexpect\s+([01])\b/.exec(rest)
    commands.set(name, { kind, name, expect: expect ? Number(expect[1]) : null })
  }
  return commands
}

/** `expect 1` means "an instance exists" for both kinds; for a `check` the instance is a counterexample. */
const expectedVerdict = (expect) => (expect === 1 ? 'SAT' : 'UNSAT')

const RESULT_RE = /^\s*\d+\.\s+(run|check)\s+(\S+)\s+.*?\b(SAT|UNSAT)\b/

function runFile(jar, file) {
  const out = mkdtempSync(join(tmpdir(), 'alloy-'))
  try {
    const proc = spawnSync(
      'java',
      ['-jar', jar, 'exec', '-c', '*', '-t', 'none', '-o', out, '-f', file],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    if (proc.error) die(`could not run the analyzer: ${proc.error.message}`)
    const text = `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`
    const results = new Map()
    for (const line of text.split('\n')) {
      const match = RESULT_RE.exec(line)
      if (match) results.set(match[2], { kind: match[1], verdict: match[3] })
    }
    return { results, text }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/* ------------------------------------------------------------------------------------------- *
 * The gate
 * ------------------------------------------------------------------------------------------- */

requireJava()
const jar = await ensureJar()

const files = readdirSync(here)
  .filter((name) => name.endsWith('.als'))
  .sort()
if (files.length === 0) die('no .als specs found next to this runner.')

const findings = []
const defects = []

for (const name of files) {
  const path = join(here, name)
  const declared = declaredCommands(readFileSync(path, 'utf8'))
  if (declared.size === 0) {
    defects.push(`${name}: no run/check commands — a spec that asks nothing proves nothing.`)
    continue
  }

  console.log(`\n${bold(name)}`)
  const { results, text } = runFile(jar, path)

  for (const command of declared.values()) {
    const observed = results.get(command.name)
    if (!observed) {
      defects.push(`${name}: the analyzer reported no result for \`${command.name}\`.\n${text.trim()}`)
      continue
    }
    if (command.expect === null) {
      defects.push(
        `${name}: \`${command.kind} ${command.name}\` carries no \`expect\`. ` +
          'An unstated expectation cannot be refuted; write `expect 0` or `expect 1`.',
      )
      continue
    }
    const wanted = expectedVerdict(command.expect)
    const ok = observed.verdict === wanted
    const label = `${command.kind} ${command.name}`.padEnd(58)
    if (ok) {
      console.log(`  ${green('ok')}    ${label} ${dim(`${observed.verdict} (expect ${command.expect})`)}`)
    } else {
      console.log(`  ${red('FOUND')} ${label} ${red(`${observed.verdict}, expected ${wanted}`)}`)
      findings.push({ file: name, ...command, wanted, got: observed.verdict })
    }
  }
}

console.log('')

for (const defect of defects) console.error(`${red('alloy:')} ${defect}`)

if (findings.length > 0) {
  console.error(bold('\nFindings against the binding layer\n'))
  for (const f of findings) {
    const what =
      f.kind === 'check'
        ? 'a counterexample exists to an assertion the documents make'
        : 'a state the documents require cannot be constructed'
    console.error(`  ${red('•')} ${f.file} — ${bold(f.name)} (${f.kind}): ${what}.`)
    console.error(`    got ${f.got}, expected ${f.wanted}. The comment above it names the section.`)
    console.error(
      dim(
        `    reproduce: java -jar ${jar} exec -c '${f.name}' -t text -o - -f ${join(here, f.file)}`,
      ),
    )
  }
  console.error(
    '\nThese are findings, not spec bugs. Do not adjust an `expect` to go green without a\n' +
      'corresponding revision to the document it was transcribed from.\n',
  )
}

if (defects.length > 0 || findings.length > 0) process.exit(1)
console.log(green('alloy: every command matched its expectation.\n'))
