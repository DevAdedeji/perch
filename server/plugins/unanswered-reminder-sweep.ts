import { nextUnansweredReminderAt, runUnansweredReminderSweep } from '@@/server/domains/notifications/unanswered-reminders'
import { safeErrorSummary } from '@@/server/utils/request-security'
import { startBackgroundSweep } from '@@/server/infrastructure/background-sweep'

export default defineNitroPlugin((app) => {
  if (import.meta.prerender) return
  const stop = startBackgroundSweep({
    intervalMs: 60_000,
    nextRunAt: nextUnansweredReminderAt,
    initialDelayMs: 10_000,
    run: () => runUnansweredReminderSweep(),
    onError: error => console.error('[reminders] sweep failed', safeErrorSummary(error))
  })
  app.hooks.hook('close', stop)
})
