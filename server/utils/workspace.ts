import type { H3Event } from 'h3'
import { and, conversations, eq, users, workspaceMembers } from '@perch/db'
import type { Conversation, Workspace, WorkspaceMember } from '@perch/db'

/** The display name of a workspace member (for the widget's "chatting with…"). */
export async function getMemberName(memberId: string): Promise<string | null> {
  const rows = await useDb()
    .select({ name: users.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.id, memberId))
    .limit(1)
  return rows[0]?.name ?? null
}

/**
 * Assert the current user belongs to `workspaceId`, optionally requiring admin.
 * Returns the user and their membership row. Throws 403 otherwise.
 */
export async function requireMembership(
  event: H3Event,
  workspaceId: string,
  opts: { admin?: boolean } = {}
): Promise<{ user: SessionUser, member: WorkspaceMember }> {
  const user = await requireUser(event)
  const db = useDb()

  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id))
  })
  if (!member) {
    throw createError({ statusCode: 403, statusMessage: 'You are not a member of this workspace' })
  }
  if (opts.admin && member.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }
  return { user, member }
}

/** Agents see the unassigned pool and their own work; admins see the workspace. */
export function canMemberAccessConversation(member: WorkspaceMember, conversation: Conversation): boolean {
  return member.role === 'admin'
    || conversation.assignedAgentId === null
    || conversation.assignedAgentId === member.id
}

/**
 * Assert the current user can act on a conversation (is a member of its
 * workspace). Returns the conversation and the caller's membership.
 */
export async function requireConversationMember(
  event: H3Event,
  conversationId: string
): Promise<{ user: SessionUser, member: WorkspaceMember, conversation: Conversation }> {
  const user = await requireUser(event)
  const db = useDb()

  const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  if (!conversation) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, conversation.workspaceId), eq(workspaceMembers.userId, user.id))
  })
  if (!member) {
    throw createError({ statusCode: 403, statusMessage: 'You are not a member of this workspace' })
  }
  if (!canMemberAccessConversation(member, conversation)) {
    throw createError({ statusCode: 403, statusMessage: 'This conversation is assigned to another agent' })
  }
  return { user, member, conversation }
}

/** Public-facing workspace shape returned to the dashboard. */
export function serializeWorkspace(w: Workspace) {
  return {
    id: w.id,
    name: w.name,
    siteId: w.siteId,
    logoUrl: w.logoUrl,
    widgetPrimaryColor: w.widgetPrimaryColor,
    widgetGreeting: w.widgetGreeting,
    widgetIntro: w.widgetIntro,
    widgetOfflineMessage: w.widgetOfflineMessage,
    widgetPosition: w.widgetPosition,
    widgetSize: w.widgetSize,
    widgetTheme: w.widgetTheme,
    widgetShowBranding: w.widgetShowBranding,
    autoAssignEnabled: w.autoAssignEnabled,
    prechatFormEnabled: w.prechatFormEnabled,
    allowedDomains: w.allowedDomains,
    businessHours: w.businessHours,
    timezone: w.timezone
  }
}
