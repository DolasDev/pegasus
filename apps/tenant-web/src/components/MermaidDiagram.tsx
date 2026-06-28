import { useEffect, useRef, useState } from 'react'
import type MermaidDefault from 'mermaid'

// Mermaid is heavy, so it is dynamically imported the first time a diagram is
// rendered — it never lands in the main bundle. The module is initialized once
// (strict security level so the author-declared diagram text can't inject
// markup) and cached across renders.
type MermaidApi = typeof MermaidDefault

let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
      })
      return mod.default
    })
  }
  return mermaidPromise
}

// Mermaid needs a unique DOM id per render call.
let renderCounter = 0

/**
 * Render a Mermaid flowchart (the author-declared workflow diagram). Falls back
 * to showing the raw source if the diagram fails to parse, so a malformed
 * `workflow.mmd` never blanks the page.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(null)
    const id = `mermaid-${++renderCounter}`
    loadMermaid()
      .then((mermaid) => mermaid.render(id, chart))
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [chart])

  if (error) {
    return (
      <div className="space-y-1">
        <p className="text-destructive text-xs">Could not render the diagram — showing source.</p>
        <pre className="bg-muted text-muted-foreground overflow-auto rounded-md p-3 text-xs">
          {chart}
        </pre>
      </div>
    )
  }

  if (!svg) {
    return <p className="text-muted-foreground text-sm">Rendering diagram…</p>
  }

  return (
    <div
      ref={containerRef}
      className="overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // svg is produced by mermaid's strict renderer (scripts/markup stripped).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
