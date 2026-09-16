import { nextWebhookDeliveryAt, runWebhookDeliverySweep, webhookDeliveryEnabled } from '@@/server/domains/webhooks/delivery'
import { safeErrorSummary } from '@@/server/utils/request-security'
import { startBackgroundSweep } from '@@/server/infrastructure/background-sweep'

export default defineNitroPlugin((app) => {
  if (import.meta.prerender || !webhookDeliveryEnabled()) return
  const stop = startBackgroundSweep({
    intervalMs: 15_000,
    nextRunAt: nextWebhookDeliveryAt,
    initialDelayMs: 5_000,
    run: () => runWebhookDeliverySweep(),
    onError: error => console.error('[webhooks] sweep failed', safeErrorSummary(error))
  })
  app.hooks.hook('close', stop)
})
