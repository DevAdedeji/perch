import * as Sentry from '@sentry/nuxt'

/**
 * A WebSocket client dropping its TCP connection mid-write surfaces as an
 * unhandled ECONNRESET rejection from deep inside the socket internals — and
 * Node's default is to crash the process. For a chat server whose clients are
 * flaky phones, that's a denial of service by disconnection. Log + report
 * instead of dying; genuine bugs still reach Sentry.
 */
export default defineNitroPlugin(() => {
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
    try {
      Sentry.captureException(reason)
    } catch {
      // Sentry not configured — the console line above is the record
    }
  })
})
