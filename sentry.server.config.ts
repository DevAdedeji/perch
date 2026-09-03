import * as Sentry from '@sentry/nuxt'
import { scrubSentryBreadcrumb, scrubSentryEvent } from './config/sentry-privacy'

// Same DSN as the client config; the env var wins so prod can rotate it.
const SENTRY_DSN = process.env.SENTRY_DSN || ''

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeBreadcrumb: scrubSentryBreadcrumb,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent
  })
}
