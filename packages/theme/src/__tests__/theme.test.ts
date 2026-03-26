import { describe, it, expect } from 'vitest'
import { colors, spacing, fontSize, borderRadius, touchTarget } from '../index'

describe('colors', () => {
  it('exports primary color', () => {
    expect(colors.primary).toBe('#FF6B35')
  })

  it('exports all status colors', () => {
    expect(colors.pending).toBeDefined()
    expect(colors.inTransit).toBeDefined()
    expect(colors.delivered).toBeDefined()
    expect(colors.cancelled).toBeDefined()
  })

  it('exports semantic colors', () => {
    expect(colors.success).toBe('#10AC84')
    expect(colors.error).toBe('#EE5A6F')
  })
})

describe('spacing', () => {
  it('exports ordered scale', () => {
    expect(spacing.xs).toBeLessThan(spacing.sm)
    expect(spacing.sm).toBeLessThan(spacing.md)
    expect(spacing.md).toBeLessThan(spacing.lg)
    expect(spacing.lg).toBeLessThan(spacing.xl)
    expect(spacing.xl).toBeLessThan(spacing.xxl)
  })
})

describe('fontSize', () => {
  it('meets minimum trucker-mode size at large', () => {
    expect(fontSize.large).toBeGreaterThanOrEqual(18)
  })
})

describe('borderRadius', () => {
  it('exports small through xl', () => {
    expect(borderRadius.small).toBeDefined()
    expect(borderRadius.medium).toBeDefined()
    expect(borderRadius.large).toBeDefined()
    expect(borderRadius.xl).toBeDefined()
  })
})

describe('touchTarget', () => {
  it('meets WCAG minimum touch target of 44px', () => {
    expect(touchTarget.minHeight).toBeGreaterThanOrEqual(44)
    expect(touchTarget.minWidth).toBeGreaterThanOrEqual(44)
  })
})
