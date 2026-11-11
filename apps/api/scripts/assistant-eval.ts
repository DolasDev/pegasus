// ---------------------------------------------------------------------------
// npm run assistant:eval — replay the ops eval set through a running assistant
// and print pass rate, mean tool calls and mean tokens (plan Verification 3).
//
// It calls POST /api/v1/assistant/evals/run on a real deployment (or local
// `npm run dev`) with YOUR Cognito ID token, so the tools run against real data
// as you. The same run is available in the Assistant Lab's eval pane.
//
//   ASSISTANT_URL=https://<function-url-or-api-base> \
//   ASSISTANT_ID_TOKEN=<your Cognito ID token> \
//   npm run assistant:eval -- [--prompt <versionId>] [--case <id> ...] [--min-pass 0.8]
//
// Exits 1 when a graded run's pass rate is under --min-pass (default: no gate).
// ---------------------------------------------------------------------------

interface CaseResult {
  id: string
  askedAs: string
  verdict: 'pass' | 'fail' | 'ungraded' | 'error'
  reasons: string[]
  toolsCalled: string[]
  latencyMs: number
}

interface Summary {
  total: number
  graded: number
  passed: number
  passRate: number | null
  meanToolCalls: number
  meanInputTokens: number
  meanOutputTokens: number
  meanLatencyMs: number
}

function arg(name: string): string[] {
  const out: string[] = []
  const argv = process.argv.slice(2)
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1]) out.push(argv[i + 1]!)
  })
  return out
}

async function main(): Promise<void> {
  const base = process.env['ASSISTANT_URL']?.replace(/\/$/, '')
  const token = process.env['ASSISTANT_ID_TOKEN']
  if (!base || !token) {
    console.error('Set ASSISTANT_URL and ASSISTANT_ID_TOKEN (see the header of this script).')
    process.exit(2)
  }
  const promptVersionId = arg('prompt')[0]
  const caseIds = arg('case')
  const minPass = arg('min-pass')[0] ? Number(arg('min-pass')[0]) : null

  const res = await fetch(`${base}/api/v1/assistant/evals/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      ...(promptVersionId ? { promptVersionId } : {}),
      ...(caseIds.length ? { caseIds } : {}),
    }),
  })
  if (!res.ok || !res.body) {
    console.error(`eval run failed: HTTP ${res.status} ${await res.text()}`)
    process.exit(1)
  }

  let summary: Summary | null = null
  let buffer = ''
  const decoder = new TextDecoder()
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const event = /^event: (.*)$/m.exec(block)?.[1]
      const data = /^data: (.*)$/m.exec(block)?.[1]
      if (!event || !data) continue
      const payload = JSON.parse(data) as Record<string, unknown>
      if (event === 'start') {
        console.log(`Running ${String(payload['total'])} case(s) on ${String(payload['modelId'])}`)
      } else if (event === 'case') {
        const r = payload as unknown as CaseResult
        const mark = { pass: 'PASS', fail: 'FAIL', ungraded: ' -- ', error: 'ERR ' }[r.verdict]
        console.log(
          `${mark}  ${r.id} (as ${r.askedAs}; tools: ${r.toolsCalled.join(', ') || 'none'}; ${(r.latencyMs / 1000).toFixed(1)}s)`,
        )
        for (const reason of r.reasons) console.log(`        ${reason}`)
      } else if (event === 'summary') {
        summary = (payload as { summary: Summary }).summary
      }
    }
  }

  if (!summary) {
    console.error('eval run ended without a summary')
    process.exit(1)
  }
  const rate =
    summary.passRate === null ? 'n/a (nothing graded)' : `${(summary.passRate * 100).toFixed(1)}%`
  console.log('')
  console.log(
    `Pass rate:        ${rate}  (${summary.passed}/${summary.graded} graded, ${summary.total} total)`,
  )
  console.log(`Mean tool calls:  ${summary.meanToolCalls.toFixed(2)}`)
  console.log(
    `Mean tokens:      ${Math.round(summary.meanInputTokens)} in / ${Math.round(summary.meanOutputTokens)} out`,
  )
  console.log(`Mean latency:     ${(summary.meanLatencyMs / 1000).toFixed(1)}s`)
  console.log('Cost: multiply mean tokens by the current Bedrock price for the model above.')

  if (minPass !== null && summary.passRate !== null && summary.passRate < minPass) {
    console.error(`Pass rate below --min-pass ${minPass}`)
    process.exit(1)
  }
}

void main()
