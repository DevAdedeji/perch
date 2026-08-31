import { createHash } from 'node:crypto'
import { and, eq, sql, widgetInstallationSignals } from '@perch/db'

export interface InstallationPage {
  url: string
  origin: string
  pathname: string
}

export const INSTALLATION_SIGNAL_FRESHNESS_MS = 15 * 60 * 1000
export const INSTALLATION_SIGNAL_WRITE_DEBOUNCE_MS = 60 * 1000
export const INSTALLATION_SIGNAL_RETENTION_MS = 24 * 60 * 60 * 1000
export const MAX_INSTALLATION_PAGES_PER_WORKSPACE = 100
export const MAX_NEW_INSTALLATION_PAGES_PER_HOUR = 30

export type InstallationSignalReason = 'installed' | 'not_seen' | 'different_page' | 'stale'

export interface InstallationSignalResult {
  installed: boolean
  reason: InstallationSignalReason
  requested: InstallationPage
  observed: InstallationPage | null
  observedAt: string | null
}

export function normalizeInstallationPage(value: unknown): InstallationPage | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) return null

  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    url.hash = ''
    url.search = ''
    return { url: url.href, origin: url.origin, pathname: url.pathname }
  } catch {
    return null
  }
}

export function normalizeInstallationOrigin(value: unknown): string | null {
  return normalizeInstallationPage(value)?.origin ?? null
}

export function observedEmbedOrigin(referer: unknown, origin: unknown): string | null {
  const refererOrigin = normalizeInstallationOrigin(referer)
  const requestOrigin = normalizeInstallationOrigin(origin)
  if (refererOrigin && requestOrigin && refererOrigin !== requestOrigin) return null
  return refererOrigin ?? requestOrigin
}

export function installationPageForOrigin(value: unknown, expectedOrigin: unknown): InstallationPage | null {
  const page = normalizeInstallationPage(value)
  const origin = normalizeInstallationOrigin(expectedOrigin)
  return page && origin === page.origin ? page : null
}

export function installationPageHash(pageUrl: string): string {
  return createHash('sha256').update(pageUrl).digest('hex')
}

export class InstallationSignalDebouncer {
  private readonly recent = new Map<string, number>()

  shouldWrite(workspaceId: string, pageHash: string, now = Date.now()): boolean {
    const key = `${workspaceId}:${pageHash}`
    const previous = this.recent.get(key)
    if (previous !== undefined && now - previous < INSTALLATION_SIGNAL_WRITE_DEBOUNCE_MS) return false
    if (this.recent.size >= 10_000) {
      for (const [recentKey, recordedAt] of this.recent) {
        if (recordedAt <= now - INSTALLATION_SIGNAL_RETENTION_MS) this.recent.delete(recentKey)
      }
      while (this.recent.size >= 10_000) {
        const oldestKey = this.recent.keys().next().value
        if (typeof oldestKey !== 'string') break
        this.recent.delete(oldestKey)
      }
    }
    this.recent.set(key, now)
    return true
  }

  forget(workspaceId: string, pageHash: string, writeTime: number): void {
    const key = `${workspaceId}:${pageHash}`
    if (this.recent.get(key) === writeTime) this.recent.delete(key)
  }
}

export function installationPageMatches(requested: InstallationPage, observed: InstallationPage): boolean {
  return requested.origin === observed.origin && requested.pathname === observed.pathname
}

export function evaluateInstallationSignal(
  requested: InstallationPage,
  observedUrl: unknown,
  observedAt: Date | string | null | undefined,
  now = new Date()
): InstallationSignalResult {
  const observed = normalizeInstallationPage(observedUrl)
  const observedDate = observedAt ? new Date(observedAt) : null
  const observedTime = observedDate?.getTime() ?? Number.NaN
  const base = {
    requested,
    observed,
    observedAt: Number.isFinite(observedTime) ? observedDate!.toISOString() : null
  }

  if (!observed || !Number.isFinite(observedTime)) {
    return { installed: false, reason: 'not_seen', ...base }
  }
  if (!installationPageMatches(requested, observed)) {
    return { installed: false, reason: 'different_page', ...base }
  }
  if (Math.max(0, now.getTime() - observedTime) > INSTALLATION_SIGNAL_FRESHNESS_MS) {
    return { installed: false, reason: 'stale', ...base }
  }
  return { installed: true, reason: 'installed', ...base }
}

const installationSignalDebouncer = new InstallationSignalDebouncer()

export async function recordWidgetInstallation(
  workspaceId: string,
  value: unknown,
  expectedOrigin: unknown,
  now = new Date()
): Promise<boolean> {
  const page = installationPageForOrigin(value, expectedOrigin)
  if (!page) return false
  const pageHash = installationPageHash(page.url)
  const writeTime = now.getTime()
  if (!installationSignalDebouncer.shouldWrite(workspaceId, pageHash, writeTime)) return false

  try {
    return await useDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`installation:${workspaceId}`}))`)

      const [existing] = await tx.select({ id: widgetInstallationSignals.id })
        .from(widgetInstallationSignals)
        .where(and(
          eq(widgetInstallationSignals.workspaceId, workspaceId),
          eq(widgetInstallationSignals.pageHash, pageHash)
        ))
        .limit(1)

      if (existing) {
        await tx.update(widgetInstallationSignals)
          .set({ pageUrl: page.url, pageOrigin: page.origin, lastSeenAt: sql`now()` })
          .where(eq(widgetInstallationSignals.id, existing.id))
        return true
      }

      await tx.execute(sql`
        delete from ${widgetInstallationSignals}
        where ${widgetInstallationSignals.workspaceId} = ${workspaceId}::uuid
          and ${widgetInstallationSignals.lastSeenAt} < now() - interval '24 hours'
      `)
      const [budget] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(widgetInstallationSignals)
        .where(and(
          eq(widgetInstallationSignals.workspaceId, workspaceId),
          sql`${widgetInstallationSignals.firstSeenAt} >= now() - interval '1 hour'`
        ))
      if ((budget?.count ?? 0) >= MAX_NEW_INSTALLATION_PAGES_PER_HOUR) return false

      await tx.execute(sql`
        delete from ${widgetInstallationSignals}
        where ${widgetInstallationSignals.id} in (
          select ${widgetInstallationSignals.id}
          from ${widgetInstallationSignals}
          where ${widgetInstallationSignals.workspaceId} = ${workspaceId}::uuid
          order by ${widgetInstallationSignals.lastSeenAt} desc
          offset ${MAX_INSTALLATION_PAGES_PER_WORKSPACE - 1}
        )
      `)
      await tx.insert(widgetInstallationSignals).values({
        workspaceId,
        pageHash,
        pageUrl: page.url,
        pageOrigin: page.origin
      })
      return true
    })
  } catch (error) {
    installationSignalDebouncer.forget(workspaceId, pageHash, writeTime)
    console.error('[installation] could not record widget load', { workspaceId, error })
    return false
  }
}
