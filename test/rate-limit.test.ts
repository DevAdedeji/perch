import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertRateLimit } from '../server/utils/rate-limit'

describe('assertRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to max hits, then throws 429', () => {
    const key = `k-${Math.random()}`
    for (let i = 0; i < 5; i++) {
      expect(() => assertRateLimit('test', key, { max: 5, windowMs: 60_000 })).not.toThrow()
    }
    expect(() => assertRateLimit('test', key, { max: 5, windowMs: 60_000 }))
      .toThrowError(expect.objectContaining({ statusCode: 429 }))
  })

  it('keeps separate keys and namespaces independent', () => {
    const key = `k-${Math.random()}`
    for (let i = 0; i < 3; i++) assertRateLimit('a', key, { max: 3, windowMs: 60_000 })
    // same key, different namespace — fresh bucket
    expect(() => assertRateLimit('b', key, { max: 3, windowMs: 60_000 })).not.toThrow()
    // different key, same namespace — fresh bucket
    expect(() => assertRateLimit('a', `${key}-other`, { max: 3, windowMs: 60_000 })).not.toThrow()
  })

  it('resets after the window elapses', () => {
    const key = `k-${Math.random()}`
    for (let i = 0; i < 3; i++) assertRateLimit('reset', key, { max: 3, windowMs: 60_000 })
    expect(() => assertRateLimit('reset', key, { max: 3, windowMs: 60_000 })).toThrow()

    vi.advanceTimersByTime(61_000)
    expect(() => assertRateLimit('reset', key, { max: 3, windowMs: 60_000 })).not.toThrow()
  })
})
