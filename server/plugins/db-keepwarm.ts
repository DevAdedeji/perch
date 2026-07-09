import { sql } from '@perch/db'

/**
 * Neon's free-tier compute autosuspends after ~5 min idle, and re-waking costs
 * ~1s on the next query. While the app is actively in use (an API request in
 * the last 12 min), ping the DB every 4 min so neither Neon's compute nor our
 * pooled connections go cold mid-session. Deliberately NOT unconditional —
 * a 24/7 ping would burn most of the free tier's compute hours.
 */
type G = typeof globalThis & { __perchLastApiActivity?: number }

const PING_INTERVAL = 4 * 60 * 1000
const ACTIVE_WINDOW = 12 * 60 * 1000

export default defineNitroPlugin(() => {
  setInterval(async () => {
    const last = (globalThis as G).__perchLastApiActivity ?? 0
    if (Date.now() - last > ACTIVE_WINDOW) return
    try {
      await useDb().execute(sql`select 1`)
    } catch {
      // transient — the next real query will reconnect
    }
  }, PING_INTERVAL).unref()
})
