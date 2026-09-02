import * as Sentry from '@sentry/nuxt'
import { scrubSentryBreadcrumb, scrubSentryEvent } from './config/sentry-privacy'

// A browser DSN is public by design, but it is still opt-in per environment.
const config = useRuntimeConfig()
const SENTRY_DSN = String(config.public.sentryDsn || '')

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: String(config.public.sentryEnvironment || (import.meta.dev ? 'development' : 'production')),
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeBreadcrumb: scrubSentryBreadcrumb,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent
  })
}
