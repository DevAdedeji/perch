import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify an identity signature from Perch.identify(): HMAC-SHA256 of the
 * subject (user_id, or email when there's no user_id), keyed with the
 * workspace's identity secret, hex-encoded. Timing-safe comparison.
 *
 * Pure — unit-tested in test/identity.test.ts.
 */
export function verifyIdentitySignature(secret: string, subject: string, hash: string): boolean {
  const expected = createHmac('sha256', secret).update(subject).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(hash, 'hex')
  } catch {
    return false
  }
  return provided.length === expected.length && timingSafeEqual(expected, provided)
}
