import { WorkflowDetailPage } from '@/routes/settings.workflows.$workflowId'

// ---------------------------------------------------------------------------
// Automation detail — /automations/$workflowId
//
// The all-user read-only view of one automation: diagram, verified envelope,
// and executions. It is the same page as Settings → Automations → detail; only
// the back link points here instead. Run / cancel / retry / re-test are gated
// by their own permissions, so a viewer sees the page without those controls.
// ---------------------------------------------------------------------------

export function AutomationDetailPage() {
  return <WorkflowDetailPage backTo="/automations" />
}
