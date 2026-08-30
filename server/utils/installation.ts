import { eq, sql, workspaces } from '@perch/db'

export interface InstallationPage {
  url: string
  origin: string
  pathname: string
}

export const INSTALLATION_SIGNAL_FRESHNESS_MS = 15 * 60 * 1000

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

export async function recordWidgetInstallation(workspaceId: string, value: unknown): Promise<void> {
  const page = normalizeInstallationPage(value)
  if (!page) return

  try {
    await useDb()
      .update(workspaces)
      .set({ widgetInstalledAt: sql`now()`, widgetInstalledUrl: page.url })
      .where(eq(workspaces.id, workspaceId))
  } catch (error) {
    console.error('[installation] could not record widget load', { workspaceId, error })
  }
}
