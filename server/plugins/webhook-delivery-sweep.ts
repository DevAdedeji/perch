const WEBHOOK_SWEEP_INTERVAL = 15_000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !webhookDeliveryEnabled()) return
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await runWebhookDeliverySweep()
    } catch (error) {
      console.error('[webhooks] delivery sweep failed', safeWebhookError(error))
    } finally {
      running = false
    }
  }
  setTimeout(sweep, 5_000).unref()
  setInterval(sweep, WEBHOOK_SWEEP_INTERVAL).unref()
})
