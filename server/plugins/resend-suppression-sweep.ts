import { safeErrorSummary } from '@@/server/utils/request-security'
import { startBackgroundSweep } from '@@/server/infrastructure/background-sweep'
import { requireResendWebhookSecret, runResendSuppressionSweep } from '@@/server/domains/notifications/resend-events'

const RESEND_SUPPRESSION_SWEEP_INTERVAL_MS = 60_000

export default defineNitroPlugin((app) => {
  if (import.meta.prerender) return
  try {
    requireResendWebhookSecret()
  } catch {
    return
  }
  const stop = startBackgroundSweep({
    intervalMs: RESEND_SUPPRESSION_SWEEP_INTERVAL_MS,
    initialDelayMs: 10_000,
    run: () => runResendSuppressionSweep(),
    onError: error => console.error('[resend] suppression sweep failed', safeErrorSummary(error))
  })
  app.hooks.hook('close', stop)
})
