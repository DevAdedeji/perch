import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq, visitors, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_id: z.string().min(8).max(128),
  user_id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  // HMAC-SHA256 of user_id (or email when no user_id), keyed with the
  // workspace's identity secret — computed on the business's server
  hash: z.string().regex(/^[a-f0-9]{64}$/i).optional()
}).refine(d => d.user_id || d.name || d.email, { message: 'Nothing to identify' })

function validSignature(secret: string, subject: string, hash: string): boolean {
  const expected = createHmac('sha256', secret).update(subject).digest()
  const provided = Buffer.from(hash, 'hex')
  return provided.length === expected.length && timingSafeEqual(expected, provided)
}

/**
 * Public identify endpoint — the host site passes its signed-in user
 * (`Perch.identify({ user_id, name, email, hash })`) so the widget can skip
 * pre-chat and agents see who they're talking to.
 *
 * Trust model: with identity verification ON (workspace setting), the payload
 * MUST carry a valid HMAC signature or it's rejected — a visitor can't claim
 * someone else's identity from the console. With it off, a valid signature
 * still marks the visitor verified; unsigned payloads are accepted as
 * self-reported (same trust level as the pre-chat form).
 */
export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }
  const { site_id, visitor_id, user_id, name, email, hash } = result.data

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.siteId, site_id) })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  }

  // the signed subject is the user_id when present, otherwise the email
  const subject = user_id ?? email
  let verified = false

  if (hash) {
    if (!workspace.identitySecret || !subject || !validSignature(workspace.identitySecret, subject, hash)) {
      throw createError({ statusCode: 401, statusMessage: 'Identity signature is invalid' })
    }
    verified = true
  } else if (workspace.identityVerificationEnabled) {
    throw createError({
      statusCode: 401,
      statusMessage: 'This workspace requires verified identities — include the hash parameter'
    })
  }

  const now = new Date()
  await db.insert(visitors).values({
    workspaceId: workspace.id,
    visitorId: visitor_id,
    externalId: user_id ?? null,
    name: name ?? null,
    email: email ?? null,
    identityVerified: verified,
    lastSeenAt: now
  }).onConflictDoUpdate({
    target: [visitors.workspaceId, visitors.visitorId],
    set: {
      lastSeenAt: now,
      identityVerified: verified,
      // only overwrite what was provided
      ...(user_id ? { externalId: user_id } : {}),
      ...(name ? { name } : {}),
      ...(email ? { email } : {})
    }
  })

  return { ok: true, verified }
})
