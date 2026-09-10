import { runAutomationSweep } from '@@/server/domains/automations/engine'
import { safeErrorSummary } from '@@/server/utils/request-security'
import { startBackgroundSweep } from '@@/server/infrastructure/background-sweep'

export default defineNitroPlugin((app) => {
  if (import.meta.prerender) return
  const stop = startBackgroundSweep({
    intervalMs: 60_000,
    run: () => runAutomationSweep(),
    onError: error => console.error('[automation] sweep failed', safeErrorSummary(error))
  })
  app.hooks.hook('close', stop)
})
