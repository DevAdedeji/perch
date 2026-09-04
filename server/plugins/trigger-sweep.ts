import { and, eq, inArray, triggerFires, visitors } from '@perch/db'
import { safeErrorSummary } from '../utils/request-security'
import { blockedVisitorIds } from '../utils/spam-control'

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

        const eligible = liveVisitors(workspaceId).map(visitor => ({
          visitor,
          rules: rules.filter(rule => visitor.page_url
            && Date.now() - visitor.page_since >= rule.dwellSeconds * 1000
            && matchesTriggerUrl(rule.urlMatch, visitor.page_url)
            && !fired.has(`${rule.id}:${visitor.visitor_ref}`))
        })).filter(candidate => candidate.rules.length)
        // Bound query parameters and load only visitors with a matching, unfired rule.
        for (let offset = 0; offset < eligible.length; offset += 200) {
          const batch = eligible.slice(offset, offset + 200)
          const rows = await useDb().select().from(visitors).where(and(
            eq(visitors.workspaceId, workspaceId), inArray(visitors.id, batch.map(candidate => candidate.visitor.visitor_ref))
          ))
          const existing = new Set(rows.map(visitor => visitor.id))
          const blocked = await blockedVisitorIds(useDb(), workspaceId, rows)
          for (const { visitor, rules: matchingRules } of batch) {
            if (!existing.has(visitor.visitor_ref) || blocked.has(visitor.visitor_ref)) continue
            for (const rule of matchingRules) {
              const key = `${rule.id}:${visitor.visitor_ref}`
              if (fired.has(key)) continue
              if (fired.size > 10_000) fired.clear()
              // the unique index decides: a returned row means we won the fire
              const [won] = await useDb().insert(triggerFires)
                .values({ triggerId: rule.id, visitorRef: visitor.visitor_ref })
                .onConflictDoNothing()
                .returning()
              if (won) {
                const delivered = sendToVisitor(workspaceId, visitor.visitor_ref, {
                  type: 'trigger.fire',
                  payload: { trigger_id: rule.id, message: rule.message }
                })
                if (!delivered) {
                // The visitor vanished between the roster snapshot and send.
                // Release the durable claim so a future visit may retry.
                  await useDb().delete(triggerFires).where(and(
                    eq(triggerFires.triggerId, rule.id),
                    eq(triggerFires.visitorRef, visitor.visitor_ref)
                  ))
                  continue
                }
              }
              // Cache only after the database operation settled successfully.
              fired.add(key)
            }
          }
        }
      }
    } catch (error) {
      console.error('[trigger-sweep] pass failed', safeErrorSummary(error))
    } finally {
      running = false
    }
  }, SWEEP_INTERVAL).unref()
})
