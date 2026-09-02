const BILLING_RECONCILIATION_INTERVAL_MS = 60_000

export default defineNitroPlugin(() => {
  if (import.meta.dev || import.meta.test) return
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await runBillingReconciliationSweep()
    } catch (error) {
      console.error('[billing-reconciliation] sweep failed', {
        error: String((error as Error)?.message ?? error).slice(0, 300)
      })
    } finally {
      running = false
    }
  }
  void sweep()
  setInterval(sweep, BILLING_RECONCILIATION_INTERVAL_MS).unref()
})
