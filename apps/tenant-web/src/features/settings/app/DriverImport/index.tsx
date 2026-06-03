// ---------------------------------------------------------------------------
// DriverImportCard — entry point for the CSV import flow.
//
// Lives on /settings/app/operations alongside the Longhaul Client selector.
// Two actions: open the import dialog, or download the example template.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { downloadTemplate } from './csv'
import { ImportDialog } from './ImportDialog'

export function DriverImportCard() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Card data-testid="driver-import-card">
        <CardHeader>
          <CardTitle>Driver Data Import</CardTitle>
          <CardDescription>
            Bulk-update driver availability (ready date, location, notes, equipment, etc.) from a
            CSV. Rows are matched to existing drivers by <strong>driver code</strong> — unmatched
            codes are skipped and reported. New drivers are not created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Start with the example template to see the expected columns. Headers are optional — you
            can map columns manually when importing a sheet without them.
          </p>
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="button" onClick={() => setOpen(true)} data-testid="driver-import-open">
            Import drivers from CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadTemplate()}
            data-testid="driver-import-template"
          >
            Download example CSV
          </Button>
        </CardFooter>
      </Card>
      <ImportDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
