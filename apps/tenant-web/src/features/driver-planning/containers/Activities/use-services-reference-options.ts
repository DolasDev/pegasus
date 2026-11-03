import { useMemo } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from '../../redux/store'
import type { ServicesReferenceOptions } from './services-filter-query'

/**
 * The labelled options the Services filter bar offers. The bar renders them,
 * and loading a saved filter rehydrates its values with them. Both come from
 * the reference-data bootstrap, so they may still be empty on first paint.
 */
export function useServicesReferenceOptions(): ServicesReferenceOptions {
  const filterOptions = useSelector((state: RootState) => state.common.filterOptions)
  const dispatcherList = useSelector((state: RootState) => state.common.dispatcherList)
  return useMemo(
    () => ({
      // The same catalog the shipments board's Last Activity filter uses.
      activityTypes: filterOptions?.activityType ?? [],
      // salesman.code is an INT in the legacy schema; the board and the saved
      // query both treat dispatcher values as strings.
      dispatchers: (dispatcherList ?? []).map((d: any) => ({
        label: `${d.first_name} ${d.last_name}`,
        value: String(d.code),
      })),
      // `branches` rows, shaped server-side (reference-data.ts).
      offices: filterOptions?.office ?? [],
    }),
    [filterOptions, dispatcherList],
  )
}
