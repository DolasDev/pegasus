#!/usr/bin/env bash
# =============================================================================
# fableplan.sh — launch Claude Code with Fable 5 for planning, Sonnet for execution
#
# Repurposes the built-in `opusplan` alias: opusplan resolves its plan-mode model
# from ANTHROPIC_DEFAULT_OPUS_MODEL and its execution model from
# ANTHROPIC_DEFAULT_SONNET_MODEL. Pointing the plan slot at Fable gives you an
# automatic Fable-plan / Sonnet-execute session.
#
# Scoped to THIS process only — the ANTHROPIC_DEFAULT_OPUS_MODEL override does not
# leak into your normal sessions, so it never silently turns the `opus` alias into
# Fable elsewhere.
#
# ⚠️ TRY-AND-VERIFY: opusplan's plan-phase switch is known to be unreliable with a
# custom ANTHROPIC_DEFAULT_OPUS_MODEL (anthropics/claude-code#16982 — it can stay on
# Sonnet through planning). The first time you run this, open `/status` during plan
# mode and confirm the active model is Fable, not Sonnet. If it stays on Sonnet,
# fall back to the manual habit: `/model fable` (press `s`) to plan, `/model sonnet`
# to execute.
#
# Requires: Claude Code >= v2.1.170, Anthropic API billing, Fable 5 access.
# Note: the opusplan plan phase runs with a 200K context window, not Fable's 1M.
# =============================================================================

set -uo pipefail

exec env ANTHROPIC_DEFAULT_OPUS_MODEL=claude-fable-5 claude --model opusplan "$@"
