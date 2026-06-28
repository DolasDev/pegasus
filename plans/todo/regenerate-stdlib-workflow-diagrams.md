# Regenerate stdlib workflow diagrams with the AI command + republish

## Context

The workflow-visualization feature (PR #376, shipped + deployed to prod
2026-06-28) made a Mermaid `workflow.mmd` **required** to package/publish a
workflow, and the tenant UI renders it on the workflow detail page so business
users can confirm a workflow matches their business rules. The SDK's
`pegasus-workflows diagram` command AI-generates that file from the workflow
source via the Anthropic API.

To keep the stdlib packageable when the requirement landed, the stdlib workflows
shipped with **hand-written starter diagrams** (faithful but minimal):

- `packages/workflows-stdlib/send_quote_followup/workflow.mmd`
- `packages/workflows-stdlib/emit_custom_event/workflow.mmd`

This is a quality-polish follow-up: replace the starters with AI-generated
diagrams and push them live. Not blocking — the starters are accurate and the
stdlib already publishes fine.

## Steps

1. `pip install 'pegasus-workflows-sdk[diagram]'` (now 0.4.0 on PyPI) and export
   `ANTHROPIC_API_KEY`.
2. From `packages/workflows-stdlib/`, run `pegasus-workflows diagram --force`
   to regenerate both `workflow.mmd` files from source. Eyeball the output for
   faithfulness (it should reflect the single-activity flow each workflow has).
3. **Bump the version** of each `[[workflow]]` in
   `packages/workflows-stdlib/pegasus-workflows.toml` (0.1.0 -> 0.1.1) — uploads
   are immutable, so republishing the same `name@version` 409s.
4. Republish to QA (then prod) — same manual SDK push path used for prior stdlib
   updates (the `publish-stdlib.yml` CI is tag-gated and its env is unwired; see
   the custom-events / integration-config dogfood memories). Publishing GLOBAL
   needs the platform tenant + a key with the right Cedar role.
5. Verify in tenant-web: the workflow detail page renders the new diagram on the
   GLOBAL library row.

## Notes

- Commit the regenerated `.mmd` files so source matches what's published.
- The diagram is embedded in the bundle, so it's pinned to the artifact version
  (`artifactSha256`) — a regenerated diagram only goes live with a new version.
