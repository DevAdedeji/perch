import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const loader = readFileSync(new URL('../packages/widget-loader/src/index.ts', import.meta.url), 'utf8')
const endpoint = readFileSync(new URL('../server/api/widget/embed-ticket.post.ts', import.meta.url), 'utf8')
const middleware = readFileSync(new URL('../server/middleware/00-security-headers.ts', import.meta.url), 'utf8')
const widget = readFileSync(new URL('../app/pages/widget.vue', import.meta.url), 'utf8')
const websocket = readFileSync(new URL('../server/routes/api/ws.ts', import.meta.url), 'utf8')

describe('origin-bound widget embed handshake', () => {
  it('authorizes the loader through browser Origin before creating the iframe', () => {
    expect(loader).toContain('/api/widget/embed-ticket?site_id=')
    expect(loader).toContain(`credentials: 'omit'`)
    expect(loader).toContain('&embed_ticket=')
    expect(loader.indexOf('/api/widget/embed-ticket?site_id='))
      .toBeLessThan(loader.indexOf(`document.createElement('iframe')`))
  })

  it('echoes only a normalized, allowed Origin and signs it into the ticket', () => {
    expect(endpoint).toContain(`normalizeInstallationOrigin(getHeader(event, 'origin'))`)
    expect(endpoint).toContain('isDomainAllowed(hostOrigin, workspace.allowedDomains)')
    expect(endpoint).toContain(`setResponseHeader(event, 'Access-Control-Allow-Origin', hostOrigin)`)
    expect(endpoint).toContain('issueEmbedTicket(event, siteId, { hostOrigin })')
  })

  it('binds iframe and postMessage traffic to the signed host origin without wildcard fallback', () => {
    expect(middleware).toContain('requireEmbedTicket(event, siteId, suppliedTicket)')
    expect(middleware).toContain('event.context.perchEmbedOrigin = embedOrigin!')
    expect(widget).toContain('let hostOrigin = embeddedHostOrigin.value')
    expect(widget).not.toContain(`hostOrigin || '*'`)
  })

  it('limits installation signals independently for each visitor and workspace', () => {
    expect(websocket).toContain(`'installation-signal:visitor'`)
    expect(websocket).toContain(`'installation-signal:workspace'`)
  })
})
