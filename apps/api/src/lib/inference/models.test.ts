import { describe, it, expect } from 'vitest'
import { baseModelId, modelFamily } from './models'

describe('modelFamily', () => {
  it('strips the cross-region profile prefix', () => {
    expect(baseModelId('us.anthropic.claude-opus-5')).toBe('anthropic.claude-opus-5')
    expect(baseModelId('eu.amazon.nova-2-lite-v1:0')).toBe('amazon.nova-2-lite-v1:0')
    expect(baseModelId('anthropic.claude-haiku-5-5')).toBe('anthropic.claude-haiku-5-5')
  })

  it('Claude: cache points in tools and system, effort through output_config', () => {
    const f = modelFamily('us.anthropic.claude-sonnet-5-5')
    expect(f.id).toBe('anthropic')
    expect(f.cachePoints).toEqual({ tools: true, system: true })
    expect(f.requestFields('high')).toEqual({ output_config: { effort: 'high' } })
  })

  it('Nova: system cache point only, no effort knob', () => {
    const f = modelFamily('us.amazon.nova-2-lite-v1:0')
    expect(f.id).toBe('amazon-nova')
    expect(f.cachePoints).toEqual({ tools: false, system: true })
    expect(f.requestFields('high')).toBeUndefined()
  })

  it('anything else works untuned: no cache points, no extra fields', () => {
    for (const id of [
      'us.openai.gpt-oss-120b-1:0',
      'mistral.mistral-large-3',
      'us.deepseek.v3-2',
    ]) {
      const f = modelFamily(id)
      expect(f.id).toBe('generic')
      expect(f.cachePoints).toEqual({ tools: false, system: false })
      expect(f.requestFields('medium')).toBeUndefined()
    }
  })
})
