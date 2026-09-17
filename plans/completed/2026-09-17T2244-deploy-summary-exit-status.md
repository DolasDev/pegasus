# A cosmetic summary step fails the deploy and skips prod

**Branch:** `fix/deploy-summary-exit-status` · **Goal:** stop `_deploy.yml`'s "Summarize outputs" step from failing a deploy that actually succeeded.

## Context (so any agent can resume)

`.github/workflows/_deploy.yml:271-293`, step "Summarize outputs":

```bash
{
  echo "### Deployed URLs (${ENV_NAME})"
  [[ -n "$WEB_URL" ]]     && echo "- Client app: $WEB_URL"
  [[ -n "$ADMIN_URL" ]]   && echo "- Admin portal: $ADMIN_URL"
  [[ -n "$API_URL" ]]     && echo "- API: $API_URL"
  [[ -n "$COMPANY_URL" ]] && echo "- Company site: $COMPANY_URL"
} >> "$GITHUB_STEP_SUMMARY"
```

The last command in the group is `[[ -n "$COMPANY_URL" ]] && echo …`. When `COMPANY_URL` is empty the test returns 1, `&&` short-circuits, and **the group's exit status is the last command's** — 1. The step runs under `set -euo pipefail`, so the step fails.

`COMPANY_URL` is empty whenever the deploy target does not include the `company-site` stack — i.e. **every api-only or web-only deploy**. It only passed until now because recent deploys happened to include it (infra changes deploy `--all`).

**Observed 2026-09-17, run 35280898726** (`feat(observability)…`, #703): CDK deploy **succeeded** — every staging stack reached UPDATE_COMPLETE — then "Summarize outputs" exited 1, failing the job. Consequence: **E2E gate, Deploy to prod, Record deployed SHA and Tag prod release were all skipped.** Staging is current; prod is NOT. The same trap hits any future api-only deploy.

## Design

Replace the `&&` one-liners with `if … fi`. An `if` whose condition is false exits 0, so the block can never fail on a missing URL, and the intent reads plainly:

```bash
{
  echo "### Deployed URLs (${ENV_NAME})"
  if [[ -n "$WEB_URL" ]];     then echo "- Client app: $WEB_URL"; fi
  if [[ -n "$ADMIN_URL" ]];   then echo "- Admin portal: $ADMIN_URL"; fi
  if [[ -n "$API_URL" ]];     then echo "- API: $API_URL"; fi
  if [[ -n "$COMPANY_URL" ]]; then echo "- Company site: $COMPANY_URL"; fi
} >> "$GITHUB_STEP_SUMMARY"
```

Rejected: appending `|| true` to the group — it would also swallow a genuine write failure to `$GITHUB_STEP_SUMMARY`, and hides rather than fixes the exit-status trap. Rejected: `set +e` — same objection, wider blast radius.

A comment above the block records why `&&` is wrong here, because the one-liner form is the tempting thing to write back.

## Checklist

- [x] Rewrite the four lines as `if … fi` + explain-why comment
- [x] Prove the bug and the fix locally with bash — old form **exits 1**, new form **exits 0** and still prints the URLs it has
- [x] Grep `.github/workflows/**` for the same shape elsewhere — see below
- [ ] PR through the merge queue; confirm its own Deploy run reaches **Deploy to prod**
- [ ] Verify prod picks up #703 (the client-error endpoint + request attribution) in that run
- [x] GOTCHAS entry
- [x] Archive plan into the impl commit

## The other `[[ … ]] && …` sites are safe — and why

Three other places use the same shape. None can fail their step, because `set -e` does
**not** abort when the failing command is the left side of an `&&` list; only a
_last-in-block_ occurrence sets the block's (and so the script's) exit status.

- `_deploy.yml` target resolver (`[[ "$COMPANY" == "true" ]] && add_stacks company-web`, …)
  — mid-script; the script ends with `echo "target=…" >> "$GITHUB_OUTPUT"`.
- `mobile-release.yml` Decide (`… && do_ios=true`) — mid-script; ends with a plain `echo`.
- `_temporal-worker.yml` rollout poll (`[[ "$STATE" == "COMPLETED" ]] && break`) — inside a
  `for` body that ends with `sleep 15`; the trailing `[[ … ]] || { … exit 1; }` is a
  deliberate failure, not an accident.

So the fix is deliberately scoped to the one site that was actually broken.

## Files

- M `.github/workflows/_deploy.yml`
- M `dolas/agents/project/GOTCHAS.md`

## Risks

- **Workflow changes cannot be tested before merge** — the fix only proves itself on the next real deploy. Mitigated by reproducing both forms locally in bash first.
- **Prod is behind main until this lands.** #703 and anything merged after it are staging-only right now.
