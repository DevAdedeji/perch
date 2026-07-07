import { and, conversations, eq, visitors, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_id: z.string().min(8).max(128)
})

/** Public: the name of the agent currently assigned to this visitor's chat (or null). */
export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  const db = useDb()
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.siteId, result.data.site_id) })
  if (!workspace) return { agent: null }

  const visitor = await db.query.visitors.findFirst({
    where: and(eq(visitors.workspaceId, workspace.id), eq(visitors.visitorId, result.data.visitor_id))
  })
  if (!visitor) return { agent: null }

  const conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.visitorRef, visitor.id), eq(conversations.status, 'open'))
  }) ?? await db.query.conversations.findFirst({
    where: and(eq(conversations.visitorRef, visitor.id), eq(conversations.status, 'unassigned'))
  })

  const name = conversation?.assignedAgentId ? await getMemberName(conversation.assignedAgentId) : null
  return { agent: name ? { name } : null }
})
