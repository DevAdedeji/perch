import { afterEach, describe, expect, it, vi } from 'vitest'
import { startBackgroundSweep } from '@@/server/infrastructure/background-sweep'

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
