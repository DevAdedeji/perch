/**
 * Stamp the last time anyone actually used the API. The db-keepwarm plugin
 * uses this to keep Neon's compute + our pool connections warm only while
 * the app is genuinely in use (free-tier compute hours are finite).
 */
type G = typeof globalThis & { __perchLastApiActivity?: number }

export default defineEventHandler((event) => {
  if (event.path.startsWith('/api/')) {
    (globalThis as G).__perchLastApiActivity = Date.now()
  }
})
