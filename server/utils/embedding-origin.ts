export interface InstallationPage {
  url: string
  origin: string
  pathname: string
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
