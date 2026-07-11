/**
 * Allowed-domains guard for the embed widget. A workspace can restrict which
 * sites may embed its chat; anyone can read a site_id out of a page's source,
 * so without this a stranger could mount your support widget on their site.
 *
 * Pure functions — unit-tested in test/domains.test.ts.
 */

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$|^localhost$/

/**
 * Normalize user input ("https://App.Example.com/path", "example.com") to a
 * bare lowercase hostname, or null if it can't be a domain.
 */
export function normalizeDomain(input: string): string | null {
  let host = input.trim().toLowerCase()
  if (!host) return null
  // tolerate pasted URLs
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname
    } catch {
      return null
    }
  }
  host = host.replace(/^www\./, '').split('/')[0]!.split(':')[0]!
  return DOMAIN_RE.test(host) ? host : null
}

/**
 * Is `pageUrl` (the embedding page) allowed by the workspace's list?
 * - empty list  → any site may embed (the default)
 * - entry match → exact hostname, its `www.`, or any subdomain
 * - no/invalid page URL while a list is configured → denied (fail closed)
 */
export function isDomainAllowed(pageUrl: string | null | undefined, allowed: string[]): boolean {
  if (!allowed.length) return true
  if (!pageUrl) return false

  let host: string
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return false
  }

  return allowed.some((entry) => {
    const domain = normalizeDomain(entry)
    return domain !== null && (host === domain || host.endsWith(`.${domain}`))
  })
}
