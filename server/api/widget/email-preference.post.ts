import { and, eq, ne, visitorEmailSuppressions, visitors } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1).max(128),
  visitor_session: z.string().min(1).max(2048),
  enabled: z.boolean()
})

export default defineEventHandler(async (event) => {
  assertRateLimit('widget-email-preference:ip', requestIp(event), { max: 20, windowMs: 60_000 })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Invalid input' })

  const { workspace, visitor } = await requireVisitorSession(event, result.data.site_id, result.data.visitor_session)
  assertRateLimit('widget-email-preference:visitor', visitor.id, { max: 10, windowMs: 60_000 })
  if (result.data.enabled && !visitor.email) {
    throw createError({ statusCode: 400, statusMessage: 'Add an email address first' })
  }

  if (result.data.enabled && visitor.email) {
    const protectedSuppression = await useDb().query.visitorEmailSuppressions.findFirst({
      where: and(
        eq(visitorEmailSuppressions.workspaceId, workspace.id),
        eq(visitorEmailSuppressions.emailHash, visitorEmailHash(visitor.email)),
        ne(visitorEmailSuppressions.reason, 'unsubscribe')
      )
    })
    if (protectedSuppression) {
      throw createError({ statusCode: 409, statusMessage: 'Email updates cannot be enabled for this address' })
    }
  }

  const db = useDb()
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(visitors).set({
      replyEmailEnabled: result.data.enabled,
      replyEmailConsentAt: result.data.enabled ? now : null,
      ...(!visitor.emailSource && visitor.email ? { emailSource: 'prechat' as const } : {})
    }).where(eq(visitors.id, visitor.id))

    if (!visitor.email) return
    const emailHash = visitorEmailHash(visitor.email)
    if (result.data.enabled) {
      await tx.delete(visitorEmailSuppressions).where(and(
        eq(visitorEmailSuppressions.workspaceId, workspace.id),
        eq(visitorEmailSuppressions.emailHash, emailHash),
        eq(visitorEmailSuppressions.reason, 'unsubscribe')
      ))
    } else {
      await tx.insert(visitorEmailSuppressions).values({
        workspaceId: workspace.id,
        emailHash,
        reason: 'unsubscribe'
      }).onConflictDoNothing()
    }
  })

  return { enabled: result.data.enabled }
})
