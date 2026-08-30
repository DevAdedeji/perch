import { and, conversations, eq, messages, sql, visitors, workspaces } from '@perch/db'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })

  const db = useDb()
  const [workspace, previewMessages] = await Promise.all([
    db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
    db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(visitors, eq(visitors.id, conversations.visitorRef))
      .where(and(
        eq(conversations.workspaceId, workspaceId),
        eq(messages.senderType, 'visitor'),
        eq(messages.isInternalNote, false),
        sql`${visitors.metadata}->>'installation_preview' = 'true'`
      ))
      .limit(1)
  ])

  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  return {
    workspace: serializeWorkspace(workspace),
    hasTestConversation: previewMessages.length > 0,
    installation: {
      lastSeenAt: workspace.widgetInstalledAt?.toISOString() ?? null,
      lastSeenUrl: workspace.widgetInstalledUrl
    }
  }
})
