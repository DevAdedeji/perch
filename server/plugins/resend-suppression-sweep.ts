import { safeErrorSummary } from '../utils/request-security'
import { requireResendWebhookSecret, runResendSuppressionSweep } from '../utils/resend-webhooks'

const RESEND_SUPPRESSION_SWEEP_INTERVAL_MS = 60_000

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  try {
    requireResendWebhookSecret()
  } catch {
    return
  }
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await runResendSuppressionSweep()
    } catch (error) {
      console.error('[resend] suppression sweep failed', safeErrorSummary(error))
    } finally {
      running = false
    }
  }
  setTimeout(sweep, 10_000).unref()
  setInterval(sweep, RESEND_SUPPRESSION_SWEEP_INTERVAL_MS).unref()
})
