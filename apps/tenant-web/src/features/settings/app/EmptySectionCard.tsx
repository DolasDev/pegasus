// Shared placeholder rendered by App Settings sections that don't have any
// real controls yet. Lets the sub-nav skeleton ship while each section is
// fleshed out independently — the same way the V-A/V-B/V-C variants on
// Availability ship as identical copies and iterate later.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface EmptySectionCardProps {
  section: string
}

export function EmptySectionCard({ section }: EmptySectionCardProps) {
  return (
    <Card data-testid={`app-settings-empty-${section.toLowerCase()}`}>
      <CardHeader>
        <CardTitle>{section}</CardTitle>
        <CardDescription>
          No tenant-wide preferences yet for the {section} section. As {section.toLowerCase()}{' '}
          preferences are added they will appear here.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Looking to change behavior in the meantime? File a request or open the section directly from
        the sidebar.
      </CardContent>
    </Card>
  )
}
