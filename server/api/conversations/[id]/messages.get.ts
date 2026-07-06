import { asc, eq, messages } from '@perch/db'

/** Full message thread for agents (includes internal notes). */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')!
  await requireConversationMember(event, conversationId)

  const db = useDb()
  const rows = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: asc(messages.createdAt)
  })
  return rows.map(serializeMessage)
})
