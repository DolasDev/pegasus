// ---------------------------------------------------------------------------
// Saved filters for the Services board: the shared Save and choose/load
// dialogs (components/saved-filters), bound to /services-filters.
// ---------------------------------------------------------------------------
import { ChooseFilterDialog, SaveFilterDialog } from '@/components/saved-filters/SavedFilterDialogs'
import {
  servicesFiltersQueryOptions,
  useDeleteServicesFilter,
  useSaveServicesFilter,
  useSetDefaultServicesFilter,
  type SavedServicesQuery,
  type ServicesFilter,
} from '@/api/queries/services-filters'

interface SaveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The board's query, already serialized. */
  query: SavedServicesQuery
}

export function SaveServicesFilterDialog(props: SaveDialogProps) {
  const save = useSaveServicesFilter()
  return <SaveFilterDialog screen="services" save={save} {...props} />
}

interface ChooseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Apply the chosen filter to the board. */
  onLoad: (filter: ServicesFilter) => void
}

export function ServicesFiltersDialog(props: ChooseDialogProps) {
  const setDefault = useSetDefaultServicesFilter()
  const remove = useDeleteServicesFilter()
  return (
    <ChooseFilterDialog
      screen="services"
      listQueryOptions={servicesFiltersQueryOptions}
      setDefault={setDefault}
      remove={remove}
      {...props}
    />
  )
}
