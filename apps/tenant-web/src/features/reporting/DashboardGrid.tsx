// ---------------------------------------------------------------------------
// The grid — used by BOTH the read-only dashboard and the editor.
//
// Sharing one component is what keeps "what I dragged" identical to "what gets
// rendered": the editor is the same grid with interaction switched on and a
// chrome overlay per card. A separate editor canvas would drift from the
// viewer's geometry the first time either changed.
//
// react-grid-layout is confined to this file. It ships its own CSS which must be
// imported once (below) — without it, items stack instead of positioning, which
// reads as a data bug rather than a missing stylesheet.
// ---------------------------------------------------------------------------

import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout'
import type { Layout, LayoutItem } from 'react-grid-layout'
import type { ReactNode } from 'react'
import 'react-grid-layout/css/styles.css'
import { GRID_COLUMNS, GRID_ROW_HEIGHT, type DashboardWidget } from './dashboard-definition'

interface DashboardGridProps {
  widgets: readonly DashboardWidget[]
  /** Render one widget's body. The grid owns geometry; the caller owns content. */
  renderWidget: (widget: DashboardWidget, index: number) => ReactNode
  /** Omit for a read-only grid. Supplying it turns on drag + resize. */
  onLayoutChange?: (layout: Layout) => void
  editable?: boolean
}

export function DashboardGrid({
  widgets,
  renderWidget,
  onLayoutChange,
  editable = false,
}: DashboardGridProps) {
  // The library's own measuring hook: it observes the CONTAINER, unlike the
  // legacy WidthProvider HOC which measures the window and so mis-sizes the
  // grid whenever the sidebar is expanded.
  const { width, containerRef } = useContainerWidth()

  const layout: LayoutItem[] = widgets.map((w, i) => ({
    i: String(i),
    x: w.layout.x,
    y: w.layout.y,
    w: w.layout.w,
    h: w.layout.h,
    static: !editable,
  }))

  return (
    <div ref={containerRef}>
      <GridLayout
        layout={layout}
        width={width}
        // v2 groups what used to be flat props into config objects, and replaced
        // `compactType="vertical"` with a compactor function.
        gridConfig={{ cols: GRID_COLUMNS, rowHeight: GRID_ROW_HEIGHT, margin: [16, 16] }}
        dragConfig={{
          enabled: editable,
          // Only the header handle starts a drag, so clicking inside a chart —
          // or on a widget's Edit/Remove buttons — doesn't drag the card.
          handle: '[data-grid-drag-handle]',
        }}
        resizeConfig={{ enabled: editable }}
        compactor={verticalCompactor}
        {...(onLayoutChange ? { onLayoutChange } : {})}
      >
        {widgets.map((widget, i) => (
          <div key={String(i)}>{renderWidget(widget, i)}</div>
        ))}
      </GridLayout>
    </div>
  )
}
