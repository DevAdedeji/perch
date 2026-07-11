import { eq, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_id: z.string().min(8).max(128),
  content: z.string().trim().max(5000).default(''),
  attachment_url: z.string().url().max(500).optional(),
  attachment_type: z.string().regex(/^image\//).max(100).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  page_url: z.string().max(2000).optional()
}).refine(d => d.content.length > 0 || d.attachment_url, { message: 'Message is empty' })

/** Public: a visitor sends a message (creates/resumes their conversation). */
export default defineEventHandler(async (event) => {
  assertRateLimit('widget-msg:ip', requestIp(event), { max: 60, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }
  const { site_id, visitor_id, content, attachment_url, attachment_type, name, email, page_url } = result.data

  // attachments must live on OUR Cloudinary image path — no arbitrary hotlinks
  if (attachment_url && !isOwnCloudinaryImageUrl(attachment_url, cloudinaryConfig().cloudName)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid attachment' })
  }
  assertRateLimit('widget-msg:visitor', visitor_id, { max: 20, windowMs: 60 * 1000 })

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.siteId, site_id) })
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  }

  const { conversation, message } = await ingestVisitorMessage({
    workspaceId: workspace.id,
    visitorId: visitor_id,
    name,
    email,
    content,
    attachmentUrl: attachment_url ?? null,
    attachmentType: attachment_url ? (attachment_type ?? 'image/*') : null,
    pageUrl: page_url
  })

  setResponseStatus(event, 201)
  return { conversation_id: conversation.id, message: serializeMessage(message) }
})
