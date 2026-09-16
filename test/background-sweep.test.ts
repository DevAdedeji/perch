import { afterEach, describe, expect, it, vi } from 'vitest'
import { startBackgroundSweep, wakeBackgroundSweeps } from '@@/server/infrastructure/background-sweep'

afterEach(() => vi.useRealTimers())

describe('background sweep lifecycle', () => {
  it('runs at the configured delay and interval, then stops all timers', async () => {
    vi.useFakeTimers()
    const run = vi.fn().mockResolvedValue(undefined)
    const stop = startBackgroundSweep({ run, onError: vi.fn(), intervalMs: 100, initialDelayMs: 20 })
    await vi.advanceTimersByTimeAsync(19)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(81)
    expect(run).toHaveBeenCalledTimes(2)
    await stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not overlap slow work and drains it when stopped', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const stop = startBackgroundSweep({ run, onError: vi.fn(), intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(1)
    let drained = false
    const stopping = stop().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    finish()
    await stopping
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reports failures without disabling subsequent passes', async () => {
    vi.useFakeTimers()
    const failure = new Error('temporary failure')
    const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const onError = vi.fn()
    const stop = startBackgroundSweep({ run, onError, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(20)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(run).toHaveBeenCalledTimes(2)
    await stop()
  })

  it('cancels the initial pass when stopped before it starts', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const stop = startBackgroundSweep({ run, onError: vi.fn(), intervalMs: 100, initialDelayMs: 20 })
    await stop()
    await vi.advanceTimersByTimeAsync(200)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('idle-aware database sweeps', () => {
  const epoch = new Date('2026-09-16T00:00:00Z')

  it('lets an empty queue sleep and aligns its safety check to the quarter hour', async () => {
    vi.useFakeTimers({ now: epoch })
    const run = vi.fn().mockResolvedValue(undefined)
    const stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 10_000, nextRunAt: async () => null, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)
    await stop()
    wakeBackgroundSweeps()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs at the saved deadline even without a visitor returning', async () => {
    vi.useFakeTimers({ now: epoch })
    const run = vi.fn().mockResolvedValue(undefined)
    const due = new Date(epoch.getTime() + 7 * 60_000)
    const stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 0, nextRunAt: async () => due, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(7 * 60_000 - 1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    await stop()
  })

  it('wakes on new work and coalesces a burst without postponing the wake-up', async () => {
    vi.useFakeTimers({ now: epoch })
    const run = vi.fn().mockResolvedValue(undefined)
    const stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 0, nextRunAt: async () => null, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    for (let i = 0; i < 100; i++) wakeBackgroundSweeps()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    wakeBackgroundSweeps()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(3)
    await stop()
  })

  it('does not lose a committed job while the next deadline is being read', async () => {
    vi.useFakeTimers({ now: epoch })
    let finish!: (value: Date | null) => void
    const run = vi.fn().mockResolvedValue(undefined)
    const nextRunAt = vi.fn().mockImplementationOnce(() => new Promise<Date | null>((resolve) => {
      finish = resolve
    })).mockResolvedValue(null)
    const stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 0, nextRunAt, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    wakeBackgroundSweeps()
    finish(null)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)
    await stop()
  })

  it('retries a failed deadline query instead of treating the database as empty', async () => {
    vi.useFakeTimers({ now: epoch })
    const failure = new Error('database unavailable')
    const run = vi.fn().mockResolvedValue(undefined)
    const nextRunAt = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(null)
    const onError = vi.fn()
    const stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 0, nextRunAt, onError })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(run).toHaveBeenCalledTimes(2)
    await stop()
  })

  it('drains a slow sweep on shutdown without overlapping or leaving wake listeners', async () => {
    vi.useFakeTimers({ now: epoch })
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 0, nextRunAt: async () => null, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    wakeBackgroundSweeps()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(run).toHaveBeenCalledTimes(1)
    let drained = false
    const stopping = stop().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    finish()
    await stopping
    wakeBackgroundSweeps()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers persisted work on restart and bounds a far-future deadline by the safety check', async () => {
    vi.useFakeTimers({ now: epoch })
    const run = vi.fn().mockResolvedValue(undefined)
    const nextRunAt = vi.fn().mockResolvedValue(new Date('2027-01-01'))
    let stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 0, nextRunAt, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    await stop()
    nextRunAt.mockResolvedValue(null)
    stop = startBackgroundSweep({ run, intervalMs: 60_000, initialDelayMs: 0, nextRunAt, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(run).toHaveBeenCalledTimes(3)
    await stop()
  })
})
