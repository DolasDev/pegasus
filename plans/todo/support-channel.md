# In-app support channel → AI triage → agent-coded fixes

> **Branch:** `feat/support-channel` (worktree `../pegasus-support-channel`). All changes stay
> on this branch.
>
> **Status 2026-11-24: Phase 1a (API slice) SHIPPED** in the PR that moved this file to
> `plans/todo/` (branch `feat/support-channel`), deployed dark: `SUPPORT_ENABLED` is on for
> staging only. Parked in `plans/todo/` because Phases 1b, 2 and 3 are not started. Move it
> back to `plans/in-progress/` when 1b starts. Answer Q1-Q4, Q6, Q7 before Phases 2-3.
>
> **Decisions taken at kickoff (Steve, 2026-11-24):**
>
> - **D8 Operator alerts go through SNS**, not email from the API. The API has **no**
>   platform email sender (SES is wired only into Cognito invites, and was last known
>   to be in the SES sandbox; the earlier "SES exists" note in this plan was wrong).
>   CDK creates topic `pegasus-support-alerts` with an email subscription (same default
>   address as `alarmEmail` in `packages/infra/bin/app.ts`). This adds
>   `@aws-sdk/client-sns` to `apps/api` (lockfile change, approved). Alerts carry tenant +
>   subject + admin-web link, not the message body (but a subject derived from a
>   subject-less message is its first line, so a one-line message reaches the email whole). **Manual step after each
>   env's first deploy: click the SNS confirmation email.**
> - **D9 (was Q5) A thread is visible only to its author** on the tenant side. Widening
>   to tenant admins later is non-breaking.
> - **D10 Phase 1 lands in two PRs.** 1a is the API slice (domain, migration, tenant and
>   admin API, authz, infra with the flag on staging only, API e2e), deployed dark. 1b is
>   the tenant-web Help panel and the admin-web inbox.

**Goal:** tenant users can reach Steve (or an AI triager) from inside Pegasus. A
conversation can become a GitHub issue (bug, investigation or feature). Steve
approves agent work from his phone, an agent produces a PR or findings, and the work
pauses for review before merging.

**Operating constraints (from Steve):** one operator, possibly a very small team later.
Simple, low maintenance, fully operable from a smartphone (browser OK). Buy before
build when the tooling is cheap. Bespoke is fine if it is simpler.

---

## Decisions (approved 2026-11-24)

| #   | Decision                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Build** the chat and the triage in Pegasus instead of buying a widget (Crisp, Chatwoot, Intercom).                                                                                    | None of the vendors surveyed (Crisp, Chatwoot, Intercom, Plain, Pylon) connects chat to a labelled GitHub issue to an agent PR; the GitHub step is custom glue anyway. Pegasus already has a push outbox + notification feed, an assistant tool loop and admin-web. Buying adds a second inbox and a subprocessor that holds tenant data. |
| D2  | **GitHub is the system of record** for work items: issues, labels, PRs, the merge queue.                                                                                                | Already the review and deploy gate. The GitHub mobile app covers labelling and PR review.                                                                                                                                                                                                                                                 |
| D3  | **The contract between Pegasus and any AI coder is "a GitHub issue + an `agent:*` label".** Pegasus never calls an executor directly.                                                   | The executor can be swapped (the Hermes bot, `claude-code-action`, Copilot) without touching Pegasus.                                                                                                                                                                                                                                     |
| D4  | **Only Steve's label starts agent work.** Customer text never triggers an agent. Executors check _who_ added the label, not only that it is there.                                      | Text from customers reaching an agent with repo write access is a prompt-injection path. A GitHub token cannot be limited to certain labels, so the triage bot _could_ add one.                                                                                                                                                           |
| D5  | **No raw transcripts in GitHub.** Issues get a sanitized summary + an admin-web link to the thread.                                                                                     | Tenant/customer PII; the repo is visible to anyone with repo access and to every agent.                                                                                                                                                                                                                                                   |
| D6  | **Primary executor = Steve's local Hermes bot** (uses spare Claude Code subscription capacity; operated from Element/Matrix). **Fallback = `claude-code-action`** on a different label. | Cost, and Element is already Steve's phone control panel. The fallback covers the box being down for something urgent.                                                                                                                                                                                                                    |
| D7  | **Pegasus's own inbox is the source of truth for support conversations.** A Matrix mirror is optional and only a convenience.                                                           | Support must not go quiet when the local box or homeserver is down. Losing the coder for a day is fine.                                                                                                                                                                                                                                   |

## Research summary (labelled by strength)

- **Hosted chat for a solo operator.** Crisp is free for 2 seats (its agent phone apps were not confirmed in any source read). Chatwoot is open source, with a free 2-agent cloud plan; Captain AI needs a
  paid plan and is credit-metered. Plain and Pylon create GitHub/Linear issues from a
  thread, but a person clicks to create; one source says Plain has no in-app widget.
  _Roundup blogs only; prices conflict between sources._
- **`claude-code-action`.** With a `prompt` input it runs on any event, including
  `issues: labeled`. It rejects bot actors unless listed in `allowed_bots`, and the
  triggering actor needs write access unless listed in `allowed_non_write_users`. For
  `labeled` the actor should be whoever added the label (_inferred_ from GitHub's actor semantics; not a quoted docs line). _Official docs, checked 2026-11-24._
- **Claude Code scheduled tasks** (formerly "routines") trigger on issue events,
  including `labeled`, and run in Anthropic's cloud. Pro/Max/Ultra/Team/Enterprise.
  Hourly caps; GitHub events over the cap are **dropped**. _Official docs._
- **Copilot coding agent** can be assigned an issue from the GitHub mobile app. It
  costs Actions minutes plus premium requests. _GitHub docs._
- **Production evidence for issue→PR agents is thin.** One write-up saw a PR ~9
  minutes after filing; guides agree it works best on small, well-specified fixes.
  _Anecdote, not data._

## Constraints found in the code

- **Move chat can't be reused as-is.** `ChatRoom`/`ChatMessage`/`ChatRoomMember`
  (`apps/api/prisma/schema.prisma`, "Move chat" models) are tenant-scoped and every
  author is a `TenantUser`. Steve posts as a platform operator, across tenants, so
  support needs its own small tables. Reuse the _patterns_: `clientMessageId`
  idempotency, soft delete, `lastMessageId` pointer, the push outbox +
  `kickPushForwarder` (`apps/api/src/handlers/chat.ts` header comment).
- **The assistant is staging-only and role-gated.** `assistantEnabled = envName ===
'staging'` (`packages/infra/bin/app.ts`), and `UseAssistant` is held only by
  `operations_admin` and `tenant_admin` (`apps/api/src/authz/policies/60-assistant.cedar`). AI triage for
  every user needs prod enablement and a separate, narrower permission (see Phase 2).
- **Operator identity = a platform admin.** Every `/api/admin/**` route requires a
  `PLATFORM_ADMIN` Cognito JWT (`apps/api/src/handlers/admin/index.ts`, `adminAuthMiddleware`);
  `GET /api/admin/me` returns its claims. Operator messages are stamped with that
  admin's Cognito `sub` (+ email for display), not a `TenantUser`.
- **Assistant tools are chosen by the caller's permissions, not by conversation mode.**
  `offeredTools()` filters `ALL_TOOLS` by what the caller may do, and `runTool()`
  re-checks (`apps/api/src/assistant/tools/registry.ts`). A tenant_admin using support
  triage would therefore also be offered every data tool. Triage needs an explicit
  per-mode tool allowlist in the registry/loop, _in addition to_ the permission gate.
- **A per-user notification feed exists for every role** (channels feed/push/off,
  `/notifications/settings` in tenant-web, from the task queue work). Customer reply
  notifications go through it.
- **The default model is Kimi K3.1**, because Anthropic models are blocked on the
  member accounts. Acceptable for triage.
- **Unrelated name clash:** `apps/tenant-web/src/components/feedback/` is the
  _customer feedback form_ feature (sdk-feedback 0033), not support. Don't put support
  UI there.

---

## Phase 1 — Chat with Steve (no AI)

Outcome: a tenant user opens Help, writes, and gets a reply. Steve is alerted on his
phone and replies from admin-web on a phone browser.

### Phase 1a — API slice (this PR, deployed dark)

Design:

- **Statuses:** `awaiting_operator` (new thread, or customer wrote last) ·
  `awaiting_customer` (operator wrote last) · `resolved` (operator closed it). A
  customer message on a resolved thread reopens it to `awaiting_operator`.
- **Alert debounce:** alert when a customer message moves the thread _into_
  `awaiting_operator`, or when the last alert for that thread is older than 30 min.
  Stored as `SupportThread.lastOperatorAlertAt`. Alert is best-effort after commit; an
  SNS failure is logged at `error` and never fails the post.
- **Idempotency:** `(threadId, authorKind, clientMessageId)` unique, as in move chat.
  Opening a thread is idempotent on the first message's `clientMessageId` for that user.
- **Read state:** `customerLastReadAt` / `operatorLastReadAt` on the thread (one reader
  per side, so no member table).
- **Customer notification:** new notification type `support.reply` (default channel
  `feed`) via `notify()` inside the reply transaction, deep link
  `{ route: '/support/<threadId>' }`.
- **Tenant routes** `/api/v1/support` (Cognito-only v1 router; `apiClient` refused 403
  `SUPPORT_HUMANS_ONLY`; every route 404 `NOT_FOUND` when `SUPPORT_ENABLED` is off):
  `GET /threads`, `POST /threads`, `GET /threads/:id`, `POST /threads/:id/messages`. A
  thread not opened by the caller answers **404** (not 403).
- **Admin routes** `/api/admin/support` (PLATFORM_ADMIN; same flag): `GET /threads?status=`,
  `GET /threads/:id`, `POST /threads/:id/messages`, `PATCH /threads/:id` `{status}`.
  `tenantId` always comes from the thread row, never the request.
- **Permissions:** `ReadSupport` (`support:read`), `PostSupport` (`support:post`), resource
  `SupportThread`, granted to every principal by `57-support-shared.cedar` (handler
  enforces "own threads only"). The SPA gates the Help entry on the `support`
  capability from `/me`, because the permission exists even where the flag is off.

Checklist (test first, then implementation):

- [x] Write `packages/domain/src/support/__tests__/support.test.ts` (failing)
- [x] Implement `packages/domain/src/support/index.ts` + export from `packages/domain/src/index.ts`
- [x] Add `support.reply` to `NOTIFICATION_TYPES`/`NOTIFICATION_TYPE_INFO` (+ domain test update)
- [x] Prisma models `SupportThread`, `SupportMessage` (+ Tenant/TenantUser back-relations), migration; add both to `TENANT_SCOPED_MODELS`
- [x] Authz: `actions.ts`, `cedar.schema.json`, `policies/57-support-shared.cedar`; update `me.test.ts`, `lib/authz.test.ts` baselines, `apps/e2e/tests/api/authz-smoke.spec.ts` persona lists
- [x] `lib/support-alert.ts` (flag + admin URL + SNS publish, one module) with tests first
- [x] Write `apps/api/src/handlers/support.test.ts` (failing), then `handlers/support.ts` + `repositories/support.repository.ts`; mount in `app.ts`
- [x] Write `apps/api/src/handlers/admin/support.test.ts` (failing), then `handlers/admin/support.ts`; mount in `handlers/admin/index.ts`
- [x] `/me` capabilities gain `support: boolean` (+ test)
- [x] Infra: `supportEnabled` (staging only) in `bin/app.ts`; `api-stack.ts` env `SUPPORT_ENABLED`, `SUPPORT_ADMIN_URL`, SNS topic + email subscription + `SUPPORT_ALERT_TOPIC_ARN` + publish grant; infra tests
- [x] `apps/e2e/tests/api/support.spec.ts` (open → list → read → isolation 404)
- [x] Full gate: `npm test`, `npm run typecheck`, lint, e2e
- [x] Update `dolas/agents/project/DECISIONS.md` / `GOTCHAS.md` as warranted

**Phase 1a — as built (read before 1b):**

- Gate verified 2026-11-24: `turbo run test --force` 16/16 tasks green (api 5557, domain
  567, infra 463, tenant-web 1770, ...); `npm run typecheck` 15/15; `npm run lint` 10/10;
  Playwright 76 tests, 37 passed, 39 skipped (env-gated), 0 failed; staging
  `cdk synth` shows `SUPPORT_*` env on the API Lambda, the topic and the email
  subscription (the only synth error is the pre-existing WireGuard lookup that needs
  AWS credentials).
- Coverage ratchet: the runs rewrote `apps/api` + `packages/domain` `vitest.config.ts`;
  both were restored to main's floors (GOTCHAS / memory: don't commit local ratchets).
- `@aws-sdk/client-sns` is pinned **exactly** at `3.1161.0`, the version every other
  `@aws-sdk/client-*` resolves to. A caret range resolved 3.1176 and nested a second
  copy of `@aws-sdk/core` + `@smithy/*` (CLAUDE.md: one version only). The lockfile
  delta is the 20 lines for that one package; npm's unrelated `"peer": true` churn on
  admin-web's lightningcss was dropped.
- Unread state uses `SupportThread.lastAuthorKind` (added before the migration was
  committed) instead of a member table: unread for a side = the other side wrote after
  that side's `*LastReadAt`.
- An alert is stamped (`lastOperatorAlertAt`) only when SNS accepted it, so a failed
  publish is retried by the next customer message.
- The admin inbox is allowlisted in `src/__tests__/db-access-guard.test.ts` (base client
  across tenants, PLATFORM_ADMIN only).
- `support.reply` notifications: feed by default; title `Pegasus support replied:
<subject>`, body = first 140 chars of the operator's reply, deep link data
  `{ route: '/support/<id>', threadId }`, `entityType: 'support_thread'`.
- Local e2e: `playwright.config.ts` now sets `SUPPORT_ENABLED=true` on the local API, and
  `support.spec.ts` seeds a `skip-auth-user` TenantUser row (GOTCHAS).
- `apps/e2e/.env.test` is modified by the worktree script: **never commit it**.
- Opening a thread is idempotent **under concurrency**: `SupportThread.openClientMessageId`
  with `@@unique([openedByUserId, openClientMessageId])`; a lost race hits P2002 and
  replays the winner (tested with two simultaneous sends).
- Dark on prod: `support.reply` is hidden from `/me/notification-preferences` unless
  `SUPPORT_ENABLED` (web and phone settings both render that list).
- The alert email carries the subject, and a subject-less thread's subject is the
  message's first line, so **a one-line message reaches the email whole**. Steve to
  decide whether 1b's form should require a subject.
- SNS `Subject` rule checked against the current Publish API reference (UTF-8, one line,
  no control characters, < 100 chars); the AWS MCP server was unavailable this session.
- The API Lambda leaves `@aws-sdk/*` external, so `@aws-sdk/client-sns` comes from the
  Node 24 runtime in prod (as SQS/S3/etc. already do); the exact pin only affects
  tests and local runs.
- The lockfile was assembled from main's plus the one SNS entry; CI's `npm ci` is its
  first independent proof.

**Known follow-ups (not blocking 1a):**

- No per-user cap on opening threads; each new thread alerts once. Add a daily cap
  (e.g. 20/user) if a tenant ever spams it.
- Admin status changes (`PATCH`) are not written to the admin audit log; replies are
  their own record.
- The admin inbox returns the newest 200 threads with no paging.

**Manual steps after merge (Steve):**

1. Staging deploy creates `pegasus-support-alerts`; click the SNS "Confirm subscription"
   email or alerts go nowhere.
2. Try the routes on staging once 1b's UIs exist (or with curl + a staging token).

## Resume here

- **Next action:** after the 1a deploy, confirm the SNS subscription email on staging,
  open one test thread and check the alert arrives (and no `support operator alert
failed` in the API logs). Then start Phase 1b on a fresh branch.

### Phase 1b — UIs (next PR)

- [ ] tenant-web: `features/support/` — Help entry in `AppShell.tsx` (**hot file**) gated on
      capability `support`, thread list + thread view + new-thread form. Attach page
      URL, app version and user agent automatically. Unread badge.
- [ ] Tenant-web Activity feed click-through for `support.reply` → `/support/:id`.
- [ ] admin-web: `routes/_auth/support/` — inbox + thread view + reply + status, built
      mobile-first (single column, large tap targets). Check on an actual phone.
- [ ] Browser e2e: customer opens thread, operator replies, customer sees it.
- [ ] Flip `supportEnabled` on prod after Steve tries it on staging.

## Phase 2 — AI triage → draft issue → Steve approves

Outcome: the assistant can answer simple how-to questions and collects facts for real
problems. It drafts an issue; Steve approves the draft on his phone and it lands in
GitHub.

- [ ] Decide placement (**Q6**): the AI answers first and hands off to Steve, or Steve
      is always in the thread and the AI only drafts. Recommendation: AI drafts only,
      at first.
- [ ] **One store for triage turns:** the thread (`SupportMessage`, authorKind
      `assistant`) is what both the customer and Steve read. The loop still writes its
      `AssistantConversation`/`AssistantTurn`/`AssistantToolCall` rows for debugging
      and evals (with `source = 'support'`), linked from the thread. Mirror only the
      final answer into `SupportMessage`.
- [ ] Add a `mode` (`chat` | `support`) to the loop. `support` offers only the triage
      tools, whatever else the caller holds (see "Constraints found in the code").
- [ ] New permission `UseSupportAssistant`, held by every tenant role, _separate_ from
      `UseAssistant`. Triage tools only; it gets none of the data tools (search
      shipments etc.) unless deliberately added.
- [ ] Assistant tool `draft_work_item` (`apps/api/src/assistant/tools/`): kind
      `bug|investigation|feature`, title, sanitized summary, repro steps,
      expected/actual, request IDs, severity guess. Writes a `SupportWorkItemDraft` row
      linked to the thread; it does **not** call GitHub.
- [ ] Support-triage system prompt as an `AssistantPromptVersion` + eval cases in the
      Lab (`assistant/evals/`): must not leak other tenants' data, must strip PII,
      must not promise fixes or dates.
- [ ] admin-web: approve / edit / reject a draft. Approval creates the GitHub issue
      through a **GitHub App** installation token (issues:write only on this repo),
      kept in Secrets Manager. Labels: `support`, `kind:*`. **Never `agent:*`.**
      Store the issue number on the draft and thread.
- [ ] Infra: enable the assistant on prod (the Bedrock form + one verified call, per
      the `assistantEnabled` comment) **or** run triage on staging only until then.
- [ ] Webhook (or a poll) from GitHub back to Pegasus: when the linked issue closes or
      the PR's deploy lands, post an operator message on the thread ("Fixed in
      today's release"). Steve can edit it before it is sent (Q7).

## Phase 3 — Agent work, gated by Steve's label

Outcome: Steve adds a label from GitHub mobile (or with an Element command). An agent
produces a draft PR or posts findings. It stops for review; merging is through the
normal queue.

Labels (create in the repo):

| Label               | Agent does                                                                                                  | Never does                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `agent:investigate` | Reads code/logs it can reach, posts findings as an issue comment.                                           | Push code.                                    |
| `agent:fix`         | Opens a **draft** PR that links the issue, with a failing test first (TDD per `engineering-principles.md`). | Merge, change workflows, touch infra secrets. |
| `agent:build`       | Same as fix, for an approved feature, with a plan file in the PR.                                           | Same.                                         |
| `agent:urgent`      | Routes to the **fallback** executor (`claude-code-action`).                                                 | Same.                                         |

### 3a — Hermes executor (primary)

Lives in Steve's Hermes repo, not this one. The checklist is here so the contract is
written down.

- [ ] Poll GitHub for open issues with `agent:*` labels. **Pull only**: no inbound
      ports on the local box.
- [ ] **Actor check:** read the issue timeline and act only if the most recent
      `labeled` event for that label came from Steve's GitHub login. Otherwise
      comment once and ignore it.
- [ ] **Edit-after-label check:** if the timeline shows the issue body or title edited
      after that `labeled` event, don't run: comment asking Steve to re-label. The
      label approves the text Steve saw, not later edits.
- [ ] Run in a container/VM with **no AWS credentials, no prod/staging DB access, no
      SSH keys**, and a fine-grained GitHub token: contents + pull-requests write on
      this repo, **no** admin, **no** workflows write. Branch protection + the merge
      queue stay the real gate.
- [ ] Treat the issue body as untrusted data in the prompt (quoted, with instructions
      only from the label's fixed prompt).
- [ ] Output: a draft PR or a comment, then remove the `agent:*` label and add
      `agent:done` / `agent:failed`. Post a link to Element.
- [ ] Element commands (optional), e.g. `approve fix #123`. If the bot applies the
      label, the bot is the actor and the actor check fails, unless the bot holds a
      token that is Steve's own, which makes the check meaningless on that path. The
      alternative: Element commands only remind, and Steve labels in GitHub.
      **Decide in Q3.**
- [ ] Rate/budget: at most N runs per day; skip when subscription capacity is low.

### 3b — `claude-code-action` fallback

- [ ] `.github/workflows/agent-issue.yml` on `issues: [labeled]`. Job condition: the
      label is `agent:urgent` AND `github.actor` is Steve's login. A fixed prompt per
      kind; `permissions` limited to contents/pull-requests/issues write. **Do not**
      set `allowed_bots`. First step: read the issue's edit history (GraphQL `userContentEdits`;
      `updated_at` alone also moves on label changes) and stop if the body was edited
      after the label (same rule as 3a). Auth via `ANTHROPIC_API_KEY` or a Claude Code OAuth token
      secret (**Q4**).
- [ ] CI must treat agent PRs like any PR: no `continue-on-error`, no skipped gates.

### 3c — Optional Matrix mirror of support threads (D7: convenience only)

- [ ] Pegasus endpoint for the bot to pull new support messages (admin-scoped service
      credential, read + reply only), and the bot posts each thread into an Element
      room; replies go back through the admin API as Steve.
- [ ] SES email (Phase 1) stays on as the floor, so nothing depends on the local box.

---

## Open questions

1. **Q1 — Is the Matrix homeserver reachable from the internet?** If yes, Pegasus could
   push notifications to it directly; if no, everything stays pull-based from the bot.
2. **Q2 — Does Hermes run the real `claude` CLI, or reuse the subscription login token
   in its own harness?** Anthropic has drawn lines on third-party tools using
   consumer-subscription logins and on automated use. **Check the current terms before
   customer work depends on it.** Not verified here.
3. **Q3 — Can Element commands apply `agent:*` labels?** See 3a; this trades the actor
   check for convenience.
4. **Q4 — Fallback auth:** API key (metered) or a Claude Code OAuth token secret.
5. **Q5 — Can a tenant_admin see all of their tenant's support threads**, or does each
   user see only their own?
6. **Q6 — Does the AI answer first, or only draft for Steve?**
7. **Q7 — Should the close-the-loop message be sent automatically or after Steve edits it?**

## Files

**Create:** `packages/domain/src/support/*` (+ tests); `apps/api/src/handlers/support.ts`
(+ test); `apps/api/src/handlers/admin/support.ts` (+ test);
`apps/api/src/assistant/tools/draft-work-item.ts` (+ test); a GitHub App client in
`apps/api/src/lib/github-app.ts`; `apps/tenant-web/src/features/support/*`;
`apps/admin-web/src/routes/_auth/support/*`; `.github/workflows/agent-issue.yml`;
`apps/e2e/tests/api/support.spec.ts`, `apps/e2e/tests/browser/support.spec.ts`; a Prisma
migration.

**Modify:** `apps/api/prisma/schema.prisma`_, `apps/api/src/authz/actions.ts`_,
`apps/api/src/authz/cedar.schema.json`_, persona `*.cedar`_,
`apps/api/src/assistant/tools/registry.ts`, `apps/api/src/app.ts`,
`apps/api/src/handlers/admin/index.ts`, `apps/tenant-web/src/components/AppShell.tsx`_,
`apps/tenant-web/src/router.tsx`_, admin-web router/nav, `packages/infra/bin/app.ts` +
the API stack (flag, GitHub App secret, Lambda env), `dolas/agents/project/DECISIONS.md`
(D1–D7 once approved). `*` = hot merge files: serialize with other streams.

**SDK:** this is not an integrations/workflows feature, so no SDK surface is owed. A
support-thread event for workflows would change that; add it then.

## Risks

- **Prompt injection** through support text reaching an agent. Mitigated by D4, the
  actor check, the sandbox and draft-only PRs. Residual: an agent PR that _looks_ fine.
  Review is the gate; agent PRs get no special trust.
- **PII leaking into GitHub or the model.** Mitigated by D5 and the triage prompt +
  evals. Residual: the summary can still carry a name. Steve's approval step catches it.
- **Support silent while the box is down.** Mitigated by D7 + SES floor.
- **Subscription-terms risk for the Hermes path** (Q2). The fallback executor removes
  the single point of failure.
- **Scheduled-task / webhook caps drop events silently** (if those are ever used). The
  label stays on the issue, so a poll-based executor naturally retries.
- **Scope creep into a helpdesk** (SLAs, macros, CSAT). Out of scope until there is a
  team.

## Sources

- [Claude Code scheduled tasks docs](https://code.claude.com/docs/en/routines)
- [Claude Code GitHub Actions docs](https://code.claude.com/docs/en/github-actions)
- [Copilot cloud agent on mobile](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-mobile)
- [Intercom vs Crisp vs Plain vs Chatwoot for solopreneurs](https://f3fundit.com/ai-customer-support-for-solopreneurs-intercom-vs-crisp-vs-plain-vs-chatwoot-2026/)
- [Best chat widgets for SaaS 2026](https://cadence.withremote.ai/blog/best-chat-widgets-saas)
- [Chatwoot pricing (eesel)](https://www.eesel.ai/blog/chatwoot-pricing)
- [Pylon GitHub Issues docs](https://docs.usepylon.com/pylon-docs/integrations/ticketing/github-issues)
- [Plain: connect GitHub/Linear issues](https://changelog.plain.com/blog/connect-github-linear-issues-customer-support)
- [Claude Code Actions: issue to merged PR](https://www.matthewswong.com/en/blog/claude-code-github-actions-guide/)
