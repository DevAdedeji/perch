import { auditLogs } from '@perch/db'
import type { SessionUser } from './require-user'
import { safeErrorSummary } from './request-security'

/**
 * Append a workspace audit entry. Fire-and-forget by design: an audit write
 * must never fail the action it describes, so callers don't await it.
 */
export function logAudit(
  workspaceId: string,
  actor: SessionUser,
  action: string,
  detail: Record<string, unknown> = {}
) {
  useDb().insert(auditLogs).values({
    workspaceId,
    actorId: actor.id,
    actorName: actor.name,
    action,
    detail
  }).catch((error) => {
    console.error('[audit] write failed', safeErrorSummary(error))
  })
}
