// AI assistant master switch. Set by CDK (ApiStackProps.assistantEnabled →
// ASSISTANT_ENABLED on the API and assistant Lambdas). Absent is off: every
// /api/v1/assistant route answers 404 and /me/permissions reports
// `capabilities.assistant = false`, so the SPA hides the Lab.
export function assistantEnabled(): boolean {
  return process.env['ASSISTANT_ENABLED'] === 'true'
}
