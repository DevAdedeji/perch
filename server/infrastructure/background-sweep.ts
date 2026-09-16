interface BackgroundSweepOptions {
  intervalMs: number
  initialDelayMs?: number
  run: () => Promise<unknown>
  onError: (error: unknown) => void
  nextRunAt?: () => Promise<Date | null>
}

const IDLE_RECHECK_MS = 15 * 60_000
const wakeups = new Set<() => void>()

/** Call after committing work. Missed signals are recovered from the database. */
export function wakeBackgroundSweeps() {
  for (const wake of wakeups) wake()
}

function startIdleAwareSweep(options: BackgroundSweepOptions): () => Promise<void> {
  let stopped = false
  let inFlight: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let scheduledAt = Infinity
  let lastStartedAt = -Infinity
  let wakeRequested = false

  function schedule(at: number) {
    if (stopped || at >= scheduledAt) return
    clearTimeout(timer)
    scheduledAt = at
    timer = setTimeout(sweep, Math.max(0, at - Date.now()))
    timer.unref()
  }

  function wake() {
    if (stopped) return
    if (inFlight) wakeRequested = true
    else schedule(Math.max(Date.now(), lastStartedAt + options.intervalMs))
  }

  function sweep() {
    scheduledAt = Infinity
    if (stopped || inFlight) return
    lastStartedAt = Date.now()
    inFlight = (async () => {
      let nextAt = Date.now() + options.intervalMs
      try {
        await options.run()
        const due = await options.nextRunAt!()
        if (due && !Number.isFinite(due.getTime())) throw new Error('Invalid background job deadline')
        // Align empty-queue checks so independent workers share one database wake-up.
        const safetyCheck = (Math.floor(Date.now() / IDLE_RECHECK_MS) + 1) * IDLE_RECHECK_MS
        nextAt = Math.min(safetyCheck, due?.getTime() ?? Infinity)
      } catch (error) {
        options.onError(error)
      } finally {
        inFlight = undefined
        if (wakeRequested) nextAt = Date.now()
        wakeRequested = false
        schedule(Math.max(nextAt, lastStartedAt + options.intervalMs))
      }
    })()
  }

  wakeups.add(wake)
  schedule(Date.now() + (options.initialDelayMs ?? options.intervalMs))
  return async () => {
    stopped = true
    wakeups.delete(wake)
    clearTimeout(timer)
    await inFlight
  }
}

/** Drives database-backed work; the database remains responsible for claims and retries. */
export function startBackgroundSweep(options: BackgroundSweepOptions): () => Promise<void> {
  if (options.nextRunAt) return startIdleAwareSweep(options)
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
