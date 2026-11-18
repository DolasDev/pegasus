// The "Workflow step" badge on an Automation execution links to the durable
// Workflow instance that started it (/workflows/$parentExecutionId).

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
  } & Record<string, unknown>) => (
    <a href={to.replace('$executionId', params?.executionId ?? '')} {...rest}>
      {children}
    </a>
  ),
}))

import { TriggerSourceBadge } from '../routes/settings.workflows'

describe('TriggerSourceBadge', () => {
  it('links a Workflow step to its parent Workflow instance', () => {
    render(<TriggerSourceBadge source="WORKFLOW" parentExecutionId="exec-parent" />)
    const link = screen.getByRole('link', { name: /workflow step/i })
    expect(link.getAttribute('href')).toBe('/workflows/exec-parent')
  })

  it('stays a plain badge when the parent id is unknown', () => {
    render(<TriggerSourceBadge source="WORKFLOW" parentExecutionId={null} />)
    expect(screen.getByText('Workflow step')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('leaves the other sources alone', () => {
    render(<TriggerSourceBadge source="EVENT" />)
    expect(screen.getByText('Event')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
