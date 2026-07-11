import { randomBytes } from 'node:crypto'
import { eq, workspaces } from '@perch/db'

/**
 * Rotate the identity-verification secret (admin only). Old HMAC hashes stop
 * validating immediately, so the embedding site must deploy the new secret —
 * that's the point of a rotation, but it's why this is a deliberate button.
 */
export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  assertRateLimit('identity-rotate:ws', workspaceId, { max: 5, windowMs: 15 * 60 * 1000 })

  const [updated] = await useDb().update(workspaces)
    .set({ identitySecret: randomBytes(24).toString('hex') })
    .where(eq(workspaces.id, workspaceId))
    .returning()
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  logAudit(workspaceId, user, 'identity_secret.rotated')
  return { identitySecret: updated.identitySecret }
})
