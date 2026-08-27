import { and, conversations, eq } from '@perch/db'
import { z } from 'zod'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_session: z.string().min(1).max(2048)
})

/** Public: the name of the agent currently assigned to this visitor's chat (or null). */
export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }

  const db = useDb()
  const { visitor } = await requireVisitorSession(event, result.data.site_id, result.data.visitor_session)

  const conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.visitorRef, visitor.id), eq(conversations.status, 'open'))
  }) ?? await db.query.conversations.findFirst({
    where: and(eq(conversations.visitorRef, visitor.id), eq(conversations.status, 'unassigned'))
  })

  const name = conversation?.assignedAgentId ? await getMemberName(conversation.assignedAgentId) : null
  return { agent: name ? { name } : null }
})
