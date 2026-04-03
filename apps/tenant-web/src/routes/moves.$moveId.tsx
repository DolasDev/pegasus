import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { PageHeader } from '@/components/PageHeader'
import { MoveStatusBadge } from '@/components/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { moveDetailQueryOptions } from '@/api/queries/moves'
import { inventoryRoomsQueryOptions } from '@/api/queries/inventory'

export function MoveDetailPage() {
  const { moveId } = useParams({ strict: false }) as { moveId: string }
  const { data: move, isLoading } = useQuery(moveDetailQueryOptions(moveId ?? ''))
  const { data: rooms = [] } = useQuery(inventoryRoomsQueryOptions(moveId ?? ''))

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!move) {
    return <EmptyState title="Move not found" />
  }

  return (
    <div>
      <PageHeader
        title={`Move ${String(move.id).slice(0, 8)}…`}
        breadcrumbs={[{ label: 'Moves', href: '/moves' }, { label: 'Detail' }]}
        action={<MoveStatusBadge status={move.status} />}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="crew">Crew & Vehicles</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Origin</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>{move.origin.line1}</p>
              <p>
                {move.origin.city}, {move.origin.state} {move.origin.postalCode}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Destination</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>{move.destination.line1}</p>
              <p>
                {move.destination.city}, {move.destination.state} {move.destination.postalCode}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Scheduled: </span>
                {move.scheduledDate instanceof Date
                  ? move.scheduledDate.toLocaleDateString()
                  : String(move.scheduledDate).slice(0, 10)}
              </p>
              <p>
                <span className="text-muted-foreground">Status: </span>
                {move.status}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          {rooms.length === 0 ? (
            <EmptyState title="No rooms" description="Add rooms to start tracking inventory." />
          ) : (
            <div className="space-y-4">
              {rooms.map((room) => (
                <Card key={String(room.id)}>
                  <CardHeader>
                    <CardTitle className="text-base">{room.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {room.items && room.items.length > 0 ? (
                      <ul className="space-y-1 text-sm">
                        {room.items.map((item) => (
                          <li key={String(item.id)} className="flex justify-between">
                            <span>{item.name}</span>
                            <span className="text-muted-foreground">× {item.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No items yet.</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="crew" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Assigned crew: {move.assignedCrewIds?.length ?? 0} member(s)
              </p>
              <p className="text-sm text-muted-foreground">
                Assigned vehicles: {move.assignedVehicleIds?.length ?? 0}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
