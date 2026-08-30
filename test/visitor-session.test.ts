import { describe, expect, it } from 'vitest'
import {
  signEmbedTicket,
  signVisitorSession,
  verifyEmbedTicket,
  verifyVisitorSession
} from '../server/utils/visitor-session'

describe('visitor session tokens', () => {
  const secret = 'a-long-test-secret-that-never-leaves-the-server'

  it('round-trips the bound workspace and visitor', () => {
    const token = signVisitorSession('workspace-a', 'visitor-a', secret, 100)
    expect(verifyVisitorSession(token, secret, 101)).toMatchObject({
      wid: 'workspace-a', vid: 'visitor-a'
    })
  })

  it('rejects tampering, the wrong secret, and expiry', () => {
    const token = signVisitorSession('workspace-a', 'visitor-a', secret, 100)
    expect(verifyVisitorSession(`${token}x`, secret, 101)).toBeNull()
    expect(verifyVisitorSession(token, 'different-secret', 101)).toBeNull()
    expect(verifyVisitorSession(token, secret, 100 + 181 * 24 * 60 * 60)).toBeNull()
  })
})

describe('widget embed tickets', () => {
  const secret = 'a-long-test-secret-that-never-leaves-the-server'

  it('keeps the installation-preview permission inside the signature', () => {
    const token = signEmbedTicket('ws_site', secret, { installationPreview: true }, 100)
    expect(verifyEmbedTicket(token, 'ws_site', secret, 101)).toMatchObject({
      sid: 'ws_site', installationPreview: true
    })
  })

  it('rejects a forged preview permission', () => {
    const token = signEmbedTicket('ws_site', secret, {}, 100)
    const [data, signature] = token.split('.')
    const payload = JSON.parse(Buffer.from(data!, 'base64url').toString())
    payload.installationPreview = true
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`
    expect(verifyEmbedTicket(forged, 'ws_site', secret, 101)).toBeNull()
  })
})
