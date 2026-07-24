import { PageHeader } from '@/components/PageHeader'
import { WorkflowSecretsConfigsPanel } from '@/features/settings/WorkflowSecretsConfigs'

/**
 * Settings → Developer → Configs. Hosts the per-tenant workflow secrets &
 * configuration key/value store (previously appended to the Workflows page).
 */
export function ConfigsSettingsPage() {
  return (
    <div className="container mx-auto max-w-4xl py-8">
      <PageHeader
        title="Configs"
        breadcrumbs={[{ label: 'Settings' }, { label: 'Developer' }, { label: 'Configs' }]}
      />
      <WorkflowSecretsConfigsPanel />
    </div>
  )
}
