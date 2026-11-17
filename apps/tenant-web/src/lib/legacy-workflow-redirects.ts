import { redirect } from '@tanstack/react-router'

// The Automations pages moved from /settings/workflows to /settings/automations
// when the product concept was renamed (plans/in-progress/
// long-running-workflows-and-automations.md, Phase 1). These `beforeLoad`
// handlers keep old bookmarks and links working, and they stay: the
// long-running Workflows section (Phase 4) lives at the top-level /workflows,
// so nothing else claims /settings/workflows.

export type AutomationDetailSearch = { tab?: 'executions' }

/** Keep only the one search param the detail page understands. */
export function validateAutomationDetailSearch(
  search: Record<string, unknown>,
): AutomationDetailSearch {
  return search.tab === 'executions' ? { tab: 'executions' } : {}
}

export function redirectLegacyWorkflowsList(): never {
  throw redirect({ to: '/settings/automations', replace: true })
}

export function redirectLegacyWorkflowDetail({
  params,
  search,
}: {
  params: { workflowId: string }
  search: AutomationDetailSearch
}): never {
  throw redirect({
    to: '/settings/automations/$workflowId',
    params: { workflowId: params.workflowId },
    search,
    replace: true,
  })
}
