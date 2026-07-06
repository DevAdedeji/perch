import { randomBytes } from 'node:crypto'

/** Public workspace identifier used in the embed script, e.g. `ws_a1b2c3d4e5`. */
export function generateSiteId(): string {
  return `ws_${randomBytes(5).toString('hex')}`
}

/** Random, URL-safe, unguessable invite token. */
export function generateInviteToken(): string {
  return randomBytes(24).toString('base64url')
}
