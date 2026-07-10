import { eq, invites, workspaces } from '@perch/db'

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

  const origin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) })
  const workspaceName = workspace?.name ?? 'a Perch workspace'

  // best-effort: the copyable link is the source of truth, email is a bonus
  const results = await Promise.all(created.map(async (inv) => {
    const url = `${origin}/join/${inv.token}`
    const emailed = await sendEmail({
      to: inv.email,
      subject: `You’ve been invited to ${workspaceName} on Perch`,
      html: emailLayout({
        title: `Join ${workspaceName}`,
        body: `<p>You’ve been invited to join <strong>${workspaceName}</strong> as ${inv.role === 'admin' ? 'an admin' : 'an agent'} on Perch — real-time support chat.</p><p>This invite expires in 7 days.</p>`,
        ctaLabel: 'Accept the invite',
        ctaUrl: url
      })
    })
    return { id: inv.id, email: inv.email, role: inv.role, url, emailed }
  }))

  return { invites: results }
})
