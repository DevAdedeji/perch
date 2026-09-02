import type { MemberNotification } from '@perch/db'
import { channels } from '@perch/shared'
import type { MemberNotificationPayload } from '@perch/shared'
import { agentWorkspaceAuthorization } from './realtime'

export function serializeMemberNotification(notification: MemberNotification): MemberNotificationPayload {
  return {
    notification_id: notification.id,
    type: notification.type,
    source: notification.source,
    conversation_id: notification.conversationId,
    message_id: notification.messageId,
    team_message_id: notification.teamMessageId,
    by_member_id: notification.actorMemberId,
    by_name: notification.actorName,
    excerpt: notification.excerpt,
    created_at: notification.createdAt.toISOString()
  }
}

export function publishMemberNotification(notification: MemberNotification): void {
  publishFiltered(channels.workspace(notification.workspaceId), {
    type: 'member.notification',
    payload: serializeMemberNotification(notification)
  }, (context) => {
    const authorization = agentWorkspaceAuthorization(context, notification.workspaceId)
    return authorization?.memberId === notification.recipientMemberId
  })
}
