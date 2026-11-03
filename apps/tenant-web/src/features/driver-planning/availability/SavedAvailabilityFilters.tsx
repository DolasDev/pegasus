// ---------------------------------------------------------------------------
// Saved filters for the Availability screen (View A): the Save dialog and the
// choose/load dialog, bound to /availability-filters. The dialogs themselves
// are the shared components/saved-filters ones (also used by Services).
// ---------------------------------------------------------------------------
import { ChooseFilterDialog, SaveFilterDialog } from '@/components/saved-filters/SavedFilterDialogs'
import {
  availabilityFiltersQueryOptions,
  useDeleteAvailabilityFilter,
  useSaveAvailabilityFilter,
  useSetDefaultAvailabilityFilter,
  type AvailabilityFilter,
  type SavedAvailabilityQuery,
} from '@/api/queries/availability-filters'

interface SaveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The filter-bar state to save, already serialized. */
  query: SavedAvailabilityQuery
}

export function SaveAvailabilityFilterDialog(props: SaveDialogProps) {
  const save = useSaveAvailabilityFilter()
  return <SaveFilterDialog screen="availability" save={save} {...props} />
}

interface ChooseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Apply the chosen filter to the page. */
  onLoad: (filter: AvailabilityFilter) => void
}

export function AvailabilityFiltersDialog(props: ChooseDialogProps) {
  const setDefault = useSetDefaultAvailabilityFilter()
  const remove = useDeleteAvailabilityFilter()
  return (
    <ChooseFilterDialog
      screen="availability"
      listQueryOptions={availabilityFiltersQueryOptions}
      setDefault={setDefault}
      remove={remove}
      {...props}
    />
  )
}
