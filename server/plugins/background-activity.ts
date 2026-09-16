import { wakeBackgroundSweeps } from '@@/server/infrastructure/background-sweep'
import type { H3Event } from 'h3'

function wakeAfterMutation(event: H3Event) {
  if (event.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(event.method)) {
    wakeBackgroundSweeps()
  }
}

export default defineNitroPlugin((app) => {
  if (import.meta.prerender) return
  // REST owns mutations; websocket messages only carry presence and typing.
  app.hooks.hook('afterResponse', wakeAfterMutation)
  app.hooks.hook('error', (_error, context) => {
    // Handled Nitro errors can skip afterResponse even after a job was committed.
    if (context.event) wakeAfterMutation(context.event)
  })
})
