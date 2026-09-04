import { and, conversations, desc, eq, ne, visitors } from '@perch/db'
import { channels } from '@perch/shared'
import { z } from 'zod'
import { safeErrorSummary } from '../../utils/request-security'

const schema = z.object({
  site_id: z.string().min(1),
  visitor_session: z.string().min(1).max(2048),
  user_id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  // HMAC-SHA256 of user_id (or email when no user_id), keyed with the
  // workspace's identity secret — computed on the business's server
  hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  email_hash: z.string().regex(/^[a-f0-9]{64}$/i).optional()
}).refine(d => d.user_id || d.name || d.email, { message: 'Nothing to identify' })

/**
 * Public identify endpoint — the host site passes its signed-in user
 * (`Perch.identify({ user_id, name, email, hash })`) so the widget can skip
 * pre-chat and agents see who they're talking to.
 *
 * Trust model: with identity verification ON (workspace setting), the payload
 * MUST carry a valid HMAC signature or it's rejected — a visitor can't claim
 * someone else's identity from the console. With it off, a valid signature
 * still marks the visitor verified; unsigned payloads are accepted as
 * self-reported (same trust level as the pre-chat form).
 */
export default defineEventHandler(async (event) => {
  assertRateLimit('widget-identify:ip', requestIp(event), { max: 15, windowMs: 60 * 1000 })

  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
  }
  const { site_id, visitor_session, user_id, name, email, hash, email_hash } = result.data

  const db = useDb()
  const { workspace, visitor } = await requireVisitorSession(event, site_id, visitor_session)

  // the signed subject is the user_id when present, otherwise the email
  const subject = user_id ?? email
  let verified = false
  let emailHostAsserted = false

  if (hash) {
    if (!workspace.identitySecret || !subject || !verifyIdentitySignature(workspace.identitySecret, subject, hash)) {
      throw createError({ statusCode: 401, statusMessage: 'Identity signature is invalid' })
    }
    verified = true
  } else if (workspace.identityVerificationEnabled) {
    throw createError({
      statusCode: 401,
      statusMessage: 'This workspace requires verified identities — include the hash parameter'
    })
  }

  if (email_hash) {
    if (!workspace.identitySecret || !email || !verifyIdentitySignature(workspace.identitySecret, email, email_hash)) {
      throw createError({ statusCode: 401, statusMessage: 'Email identity signature is invalid' })
    }
    emailHostAsserted = true
  } else if (hash && email && !user_id) {
    emailHostAsserted = verified
  }

  const now = new Date()
  const emailChanged = !!email && email !== visitor.email?.trim().toLowerCase()
  const [updated] = await db.update(visitors).set({
    lastSeenAt: now,
    identityVerified: verified,
    ...(user_id ? { externalId: user_id } : {}),
    ...(name ? { name } : {}),
    ...(email
      ? {
          email,
          emailSource: emailHostAsserted ? 'host_asserted' as const : 'unsigned_identify' as const,
          emailUpdatedAt: now,
          ...(emailChanged ? { replyEmailEnabled: false, replyEmailConsentAt: null } : {})
        }
      : {})
  }).where(eq(visitors.id, visitor.id)).returning()
  const messagingAvailable = updated ? !await isVisitorMessagingBlocked(updated) : true

  // keep the live roster's identity snapshot fresh
  if (updated) {
    visitorIdentified(workspace.id, updated.id, {
      name: updated.name,
      email: updated.email,
      verified: updated.identityVerified
    })
    const conversation = messagingAvailable
      ? await db.query.conversations.findFirst({
          where: and(
            eq(conversations.workspaceId, workspace.id),
            eq(conversations.visitorRef, updated.id),
            ne(conversations.status, 'resolved')
          ),
          orderBy: desc(conversations.lastMessageAt)
        })
      : null
    if (conversation) {
      try {
        const automated = await runEntryAutomations(conversation, updated)
        if (automated.conversation.assignedAgentId !== conversation.assignedAgentId) {
          publishConversationUpdate(automated.conversation, { previousAssignedAgentId: conversation.assignedAgentId })
        }
        if (automated.tagsChanged) {
          publishFiltered(channels.workspace(workspace.id), {
            type: 'conversation.refresh',
            payload: { conversation_id: conversation.id }
          }, inboxScope(workspace.id, automated.conversation.assignedAgentId, automated.conversation.collaboratorMemberIds))
        }
      } catch (error) {
        console.error('[automation] identify pass failed', {
          conversationId: conversation.id,
          ...safeErrorSummary(error)
        })
      }
    }
  }

  return {
    ok: true,
    verified,
    email_verified: emailHostAsserted,
    messaging_available: messagingAvailable
  }
})
