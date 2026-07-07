import { eq, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_id: z.string().min(8).max(128),
  content: z.string().trim().min(1, 'Message is empty').max(5000),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  page_url: z.string().max(2000).optional()
})

/** Public: a visitor sends a message (creates/resumes their conversation). */
export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input', data: result.error.flatten() })
  }
  const { site_id, visitor_id, content, name, email, page_url } = result.data

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
    pageUrl: page_url
  })

  setResponseStatus(event, 201)
  return { conversation_id: conversation.id, message: serializeMessage(message) }
})
