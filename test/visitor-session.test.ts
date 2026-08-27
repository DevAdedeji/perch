import { describe, expect, it } from 'vitest'
import { signVisitorSession, verifyVisitorSession } from '../server/utils/visitor-session'

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
