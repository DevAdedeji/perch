import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyIdentitySignature } from '../server/utils/identity'

const SECRET = 'workspace-identity-secret'

function sign(subject: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(subject).digest('hex')
}

describe('Perch.identify HMAC verification', () => {
  it('accepts a hash signed with the workspace secret', () => {
    expect(verifyIdentitySignature(SECRET, 'user_42', sign('user_42'))).toBe(true)
  })

  it('rejects a hash for a different subject — no impersonation', () => {
    expect(verifyIdentitySignature(SECRET, 'user_43', sign('user_42'))).toBe(false)
  })

  it('rejects a hash signed with the wrong secret', () => {
    expect(verifyIdentitySignature(SECRET, 'user_42', sign('user_42', 'other-secret'))).toBe(false)
  })

  it('rejects malformed and truncated hashes without throwing', () => {
    expect(verifyIdentitySignature(SECRET, 'user_42', 'deadbeef')).toBe(false)
    expect(verifyIdentitySignature(SECRET, 'user_42', 'not-hex-at-all')).toBe(false)
    expect(verifyIdentitySignature(SECRET, 'user_42', '')).toBe(false)
  })
})
