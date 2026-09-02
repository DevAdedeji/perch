import { and, eq, inArray, sql, tags, visitorTags, visitors } from '@perch/db'
import { channels } from '@perch/shared'

/** Update internal customer context without changing visitor-supplied identity. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { user, member, conversation } = await requireConversationMember(event, conversationId)
  assertRateLimit('customer-profile:member', member.id, { max: 60, windowMs: 60 * 1000 })
  const result = await readValidatedBody(event, body => customerProfileUpdateSchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid customer details', data: result.error.flatten() })
  }

  const input = result.data
  const db = useDb()
  const updated = await db.transaction(async (tx) => {
    const requestedTagIds = input.tag_ids
    if (requestedTagIds?.length) {
      const ownedTags = await tx.select({ id: tags.id }).from(tags).where(and(
        eq(tags.workspaceId, conversation.workspaceId),
        inArray(tags.id, requestedTagIds)
      ))
      if (ownedTags.length !== requestedTagIds.length) {
        throw createError({ statusCode: 400, statusMessage: 'One or more customer tags are unavailable' })
      }
    }

    const [visitor] = await tx.update(visitors).set({
      ...(input.name !== undefined ? { profileName: input.name } : {}),
      ...(input.email !== undefined ? { profileEmail: input.email } : {}),
      ...(input.company !== undefined ? { company: input.company } : {}),
      ...(input.job_title !== undefined ? { jobTitle: input.job_title } : {}),
      ...(input.internal_note !== undefined ? { internalNote: input.internal_note } : {}),
      profileVersion: sql`${visitors.profileVersion} + 1`
    }).where(and(
      eq(visitors.id, conversation.visitorRef),
      eq(visitors.workspaceId, conversation.workspaceId),
      eq(visitors.profileVersion, input.expected_version)
    )).returning()

    if (!visitor) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Customer details changed elsewhere. Refresh and try again.'
      })
    }

    if (requestedTagIds) {
      await tx.delete(visitorTags).where(eq(visitorTags.visitorId, visitor.id))
      if (requestedTagIds.length) {
        await tx.insert(visitorTags).values(requestedTagIds.map(tagId => ({ visitorId: visitor.id, tagId })))
      }
    }
    return visitor
  })

  const changed = ['name', 'email', 'company', 'job_title', 'internal_note', 'tag_ids']
    .filter(field => input[field as keyof typeof input] !== undefined)
  logAudit(conversation.workspaceId, user, 'customer.profile_updated', {
    visitorId: updated.id,
    changed,
    tagCount: input.tag_ids?.length
  })
  publishFiltered(channels.workspace(conversation.workspaceId), {
    type: 'conversation.refresh',
    payload: { conversation_id: conversation.id }
  }, inboxScope(conversation.workspaceId, conversation.assignedAgentId, conversation.collaboratorMemberIds))

  return getCustomerContext(conversation, member)
})
