import { nextBillingReconciliationAt, runBillingReconciliationSweep } from '@@/server/domains/billing/subscriptions'
import { startBackgroundSweep, wakeBackgroundSweeps } from '@@/server/infrastructure/background-sweep'
import { safeErrorSummary } from '@@/server/utils/request-security'

const BILLING_RECONCILIATION_INTERVAL_MS = 60_000

export default defineNitroPlugin((app) => {
  if (import.meta.prerender || import.meta.dev || import.meta.test) return
  const stop = startBackgroundSweep({
    intervalMs: BILLING_RECONCILIATION_INTERVAL_MS,
    nextRunAt: nextBillingReconciliationAt,
    initialDelayMs: 0,
    run: async () => {
      const result = await runBillingReconciliationSweep()
      // A recovered payment can change reminder entitlements without an HTTP request.
      if (result.checked > 0) wakeBackgroundSweeps()
      if (result.failed > 0) {
        console.error('[billing-reconciliation] sweep completed with failed jobs', {
          checked: result.checked,
          failed: result.failed
        })
      }
    },
    onError: error => console.error('[billing-reconciliation] sweep failed', safeErrorSummary(error))
  })
  app.hooks.hook('close', stop)
})
