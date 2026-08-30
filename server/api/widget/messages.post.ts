import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_session: z.string().min(1).max(2048),
  content: z.string().trim().max(5000).default(''),
  attachment_url: z.string().url().max(500).optional(),
  attachment_type: z.string().regex(/^image\//).max(100).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  page_url: z.string().max(2000).optional(),
  // set when this reply answers a proactive trigger — threads the trigger text in
  trigger_id: z.string().uuid().optional()
}).refine(d => d.content.length > 0 || d.attachment_url, { message: 'Message is empty' })

/** Public: a visitor sends a message (creates/resumes their conversation). */
export default defineEventHandler(async (event) => {
  assertRateLimit('widget-msg:ip', requestIp(event), { max: 60, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }
  const { site_id, visitor_session, content, attachment_url, attachment_type, name, email, page_url, trigger_id } = result.data

  // attachments must live on OUR Cloudinary image path — no arbitrary hotlinks
  if (attachment_url && !isOwnCloudinaryImageUrl(attachment_url, cloudinaryConfig().cloudName)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid attachment' })
  }
  const { workspace, visitor } = await requireVisitorSession(event, site_id, visitor_session)
  assertRateLimit('widget-msg:visitor', visitor.id, { max: 20, windowMs: 60 * 1000 })

  const { conversation, message } = await ingestVisitorMessage({
    workspaceId: workspace.id,
    visitorId: visitor.visitorId,
    name,
    email,
    content,
    attachmentUrl: attachment_url ?? null,
    attachmentType: attachment_url ? (attachment_type ?? 'image/*') : null,
    pageUrl: page_url,
    triggerId: trigger_id
  })

  setResponseStatus(event, 201)
  return { conversation_id: conversation.id, message: serializeVisitorMessage(message) }
})
