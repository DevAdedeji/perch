import { and, eq, triggers } from '@perch/db'
import type { Trigger } from '@perch/db'

/**
 * Proactive-trigger matching + the per-workspace rules cache the sweep reads.
 * The matcher is pure — unit-tested in test/triggers.test.ts.
 */

/**
 * Does a rule apply to this page? Case-insensitive substring over the full
 * URL; an empty/blank pattern matches every page.
 */
export function matchesTriggerUrl(pattern: string, url: string): boolean {
  const p = pattern.trim().toLowerCase()
  if (!p) return true
  return url.toLowerCase().includes(p)
}

/* enabled-rules cache (the sweep runs every ~5s; don't query each pass) */

interface CacheEntry { at: number, rules: Trigger[] }

const CACHE_TTL = 30_000
const g = globalThis as unknown as { __perchTriggerCache?: Map<string, CacheEntry> }
const cache: Map<string, CacheEntry> = (g.__perchTriggerCache ??= new Map())

export async function getEnabledTriggers(workspaceId: string): Promise<Trigger[]> {
  const hit = cache.get(workspaceId)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rules
  const rules = await useDb().query.triggers.findMany({
    where: and(eq(triggers.workspaceId, workspaceId), eq(triggers.enabled, true))
  })
  cache.set(workspaceId, { at: Date.now(), rules })
  return rules
}

/** Call after any trigger CRUD so the sweep sees the change immediately. */
export function invalidateTriggerCache(workspaceId: string) {
  cache.delete(workspaceId)
}
