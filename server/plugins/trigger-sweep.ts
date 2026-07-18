import { triggerFires } from '@perch/db'

/**
 * Proactive-trigger sweep. Every 5s, look at who's live (visitor-presence
 * registry), match enabled rules (URL substring + dwell), and fire at most
 * once per visitor per rule. The `trigger_fires` unique index is the atomic
 * once-only guard (same idea as the §6.4 claim race); the in-memory set just
 * keeps repeat sweeps off the DB. Skips entirely while nobody is on-site.
 */

const SWEEP_INTERVAL = 5_000

// fired keys we've already settled (`${triggerId}:${visitorRef}`) — a DB-hit
// shield only, never the source of truth. Cleared when it grows silly.
const fired = new Set<string>()

export default defineNitroPlugin(() => {
  let running = false

  setInterval(async () => {
    if (running) return // a slow DB round shouldn't stack sweeps
    running = true
    try {
      for (const workspaceId of liveWorkspaceIds()) {
        const rules = await getEnabledTriggers(workspaceId)
        if (!rules.length) continue

        for (const visitor of liveVisitors(workspaceId)) {
          if (!visitor.page_url) continue
          const dwellMs = Date.now() - visitor.page_since

          for (const rule of rules) {
            if (dwellMs < rule.dwellSeconds * 1000) continue
            if (!matchesTriggerUrl(rule.urlMatch, visitor.page_url)) continue

            const key = `${rule.id}:${visitor.visitor_ref}`
            if (fired.has(key)) continue
            if (fired.size > 10_000) fired.clear()
            fired.add(key)

            // the unique index decides: a returned row means we won the fire
            const [won] = await useDb().insert(triggerFires)
              .values({ triggerId: rule.id, visitorRef: visitor.visitor_ref })
              .onConflictDoNothing()
              .returning()
            if (won) {
              sendToVisitor(workspaceId, visitor.visitor_ref, {
                type: 'trigger.fire',
                payload: { trigger_id: rule.id, message: rule.message }
              })
            }
          }
        }
      }
    } catch (err) {
      console.error('[trigger-sweep] pass failed:', err)
    } finally {
      running = false
    }
  }, SWEEP_INTERVAL).unref()
})
