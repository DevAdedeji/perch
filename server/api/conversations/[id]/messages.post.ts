import { and, eq, inArray, workspaceMembers } from '@perch/db'
import { z } from 'zod'

const bodySchema = z.object({
  content: z.string().trim().max(5000).default(''),
  attachment_url: z.string().url().max(500).optional(),
  attachment_type: z.string().regex(/^image\//).max(100).optional(),
  is_internal_note: z.boolean().optional(),
  // @mentions — internal notes only; ids picked client-side from the roster
  mentioned_member_ids: z.array(z.string().uuid()).max(10).optional()
}).refine(d => d.content.length > 0 || d.attachment_url, { message: 'Message is empty' })

/** Agent reply (or internal note) to a conversation — text, image, or both. */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  const { user, member, conversation } = await requireConversationMember(event, conversationId)

  const result = await readValidatedBody(event, body => bodySchema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }

  // attachments must live on OUR Cloudinary image path — no arbitrary hotlinks
  if (result.data.attachment_url && !isOwnCloudinaryImageUrl(result.data.attachment_url, cloudinaryConfig().cloudName)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid attachment' })
  }
  if (conversation.isSpam && !result.data.is_internal_note) {
    throw createError({ statusCode: 409, statusMessage: 'Restore this conversation before replying' })
  }

  // Mention recipients are deduplicated, cannot include the author, and must
  // belong to the same workspace. The validated ids are persisted with the
  // note and its notifications in one transaction.
  const requestedMentionIds = result.data.is_internal_note
    ? [...new Set(result.data.mentioned_member_ids ?? [])].filter(id => id !== member.id)
    : []
  const targets = requestedMentionIds.length
    ? await useDb()
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, conversation.workspaceId),
          inArray(workspaceMembers.id, requestedMentionIds)
        ))
    : []
  const mentionRecipientIds = targets.map(target => target.id)

  const message = await addAgentMessage({
    conversationId,
    workspaceId: conversation.workspaceId,
    senderMemberId: member.id,
    content: result.data.content,
    attachmentUrl: result.data.attachment_url ?? null,
    attachmentType: result.data.attachment_url ? (result.data.attachment_type ?? 'image/*') : null,
    isInternalNote: result.data.is_internal_note,
    mentionRecipientIds,
    actorName: user.name
  })

  setResponseStatus(event, 201)
  return { message: serializeMessage(message) }
})
