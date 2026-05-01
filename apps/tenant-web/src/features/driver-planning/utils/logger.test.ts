import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import logger from './logger'

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('info forwards to console.log with [default] prefix', () => {
    logger.info('hello', 'world')
    expect(logSpy).toHaveBeenCalledWith('[default]', 'hello', 'world')
  })

  it('warn forwards to console.warn with prefix, error and context', () => {
    const err = new Error('boom')
    logger.warn(err, { id: 1 })
    expect(warnSpy).toHaveBeenCalledWith('[default]', err, { id: 1 })
  })

  it('warn defaults context to {} when omitted', () => {
    const err = new Error('boom')
    logger.warn(err)
    expect(warnSpy).toHaveBeenCalledWith('[default]', err, {})
  })

  it('error forwards to console.error with prefix, error and context', () => {
    const err = new Error('bad')
    logger.error(err, { id: 2 })
    expect(errorSpy).toHaveBeenCalledWith('[default]', err, { id: 2 })
  })

  it('error defaults context to {} when omitted', () => {
    const err = new Error('bad')
    logger.error(err)
    expect(errorSpy).toHaveBeenCalledWith('[default]', err, {})
  })
})
