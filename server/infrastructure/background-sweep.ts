interface BackgroundSweepOptions {
  intervalMs: number
  initialDelayMs?: number
  run: () => Promise<unknown>
  onError: (error: unknown) => void
}

/** Drives database-backed work; the database remains responsible for claims and retries. */
export function startBackgroundSweep(options: BackgroundSweepOptions): () => Promise<void> {
  let stopped = false
  let inFlight: Promise<unknown> | undefined
  const sweep = () => {
    if (stopped || inFlight) return inFlight
    inFlight = Promise.resolve().then(options.run).catch(options.onError).finally(() => {
      inFlight = undefined
    })
    return inFlight
  }
  const interval = setInterval(sweep, options.intervalMs)
  interval.unref()
  const initial = options.initialDelayMs === undefined ? undefined : setTimeout(sweep, options.initialDelayMs)
  initial?.unref()

  return async () => {
    stopped = true
    clearInterval(interval)
    clearTimeout(initial)
    await inFlight
  }
}
