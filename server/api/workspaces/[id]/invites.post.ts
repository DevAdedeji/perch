import { invites } from '@perch/db'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const result = await readValidatedBody(event, body => invitesSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }

  const db = useDb()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  const rows = result.data.invites.map(i => ({
    workspaceId,
    email: i.email,
    role: i.role,
    token: generateInviteToken(),
    expiresAt
  }))

  const created = await db.insert(invites).values(rows).returning()

  const origin = getRequestURL(event).origin
  return {
    invites: created.map(inv => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      url: `${origin}/join/${inv.token}`
    }))
  }
})
