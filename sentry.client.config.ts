import * as Sentry from '@sentry/nuxt'

// The DSN is public by design — it ships in the client bundle.
// From: Sentry → Settings → Projects → perch → Client Keys (DSN)
const SENTRY_DSN = 'https://432fb2dc815bcc741bc1415a25ae2678@o4511715546890240.ingest.us.sentry.io/4511715551019008'

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.dev ? 'development' : 'production',
    // errors are the point; keep tracing light on the free quota
    tracesSampleRate: 0.1
  })
}
