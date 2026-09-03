import { safeErrorSummary } from '../utils/request-security'

const PRIVACY_SWEEP_INTERVAL = 60 * 60 * 1000

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await runPrivacyRetentionSweep()
    } catch (error) {
      console.error('[privacy-retention] sweep failed', safeErrorSummary(error))
    } finally {
      running = false
    }
  }
  setTimeout(sweep, 30_000).unref()
  setInterval(sweep, PRIVACY_SWEEP_INTERVAL).unref()
})
