import { and, eq, inArray, workspaceMembers } from '@perch/db'
import { channels } from '@perch/shared'
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

  const message = await addAgentMessage({
    conversationId,
    workspaceId: conversation.workspaceId,
    senderMemberId: member.id,
    content: result.data.content,
    attachmentUrl: result.data.attachment_url ?? null,
    attachmentType: result.data.attachment_url ? (result.data.attachment_type ?? 'image/*') : null,
    isInternalNote: result.data.is_internal_note
  })

  // @mentions ping only the named teammates, only on internal notes, and never
  // the author themselves — validated against the roster so ids can't cross tenants
  const mentionIds = result.data.is_internal_note
    ? (result.data.mentioned_member_ids ?? []).filter(id => id !== member.id)
    : []
  if (mentionIds.length) {
    const targets = await useDb()
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, conversation.workspaceId),
        inArray(workspaceMembers.id, mentionIds)
      ))
    if (targets.length) {
      const targetIds = new Set(targets.map(t => t.id))
      publishFiltered(channels.workspace(conversation.workspaceId), {
        type: 'mention',
        payload: {
          conversation_id: conversationId,
          message_id: message.id,
          by_member_id: member.id,
          by_name: user.name,
          excerpt: result.data.content.slice(0, 90)
        }
      }, ctx => targetIds.has(ctx.memberId as string))
    }
  }

  setResponseStatus(event, 201)
  return { message: serializeMessage(message) }
})
