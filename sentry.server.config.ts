import * as Sentry from '@sentry/nuxt'

// Same DSN as the client config; the env var wins so prod can rotate it.
const SENTRY_DSN = process.env.SENTRY_DSN || ''

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    tracesSampleRate: 0.1
  })
}
