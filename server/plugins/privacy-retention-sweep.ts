import { runPrivacyRetentionSweep } from '@@/server/domains/privacy/retention'
import { safeErrorSummary } from '@@/server/utils/request-security'
import { startBackgroundSweep } from '@@/server/infrastructure/background-sweep'

export default defineNitroPlugin((app) => {
  if (import.meta.prerender) return
  const stop = startBackgroundSweep({
    intervalMs: 60 * 60 * 1000,
    initialDelayMs: 30_000,
    run: () => runPrivacyRetentionSweep(),
    onError: error => console.error('[privacy-retention] sweep failed', safeErrorSummary(error))
  })
  app.hooks.hook('close', stop)
})
