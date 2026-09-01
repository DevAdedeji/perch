import {
  and,
  eq,
  inArray,
  isNull,
  or,
  visitorBlocks,
  visitors,
  type Database,
  type Visitor
} from '@perch/db'

export const MESSAGING_UNAVAILABLE_CODE = 'MESSAGING_UNAVAILABLE'

type VisitorIdentity = Pick<Visitor, 'id' | 'workspaceId' | 'externalId' | 'identityVerified'>
type ReadableDatabase = Pick<Database, 'select' | 'query'>

/**
 * A signed host identity may legitimately acquire a new browser session. Only
 * verified external ids are linked; self-reported email/name must never block
 * another person who typed the same value.
 */
export async function linkedVisitorIds(db: ReadableDatabase, visitor: VisitorIdentity): Promise<string[]> {
  const rows = await db.select({ id: visitors.id }).from(visitors).where(and(
    eq(visitors.workspaceId, visitor.workspaceId),
    visitor.identityVerified && visitor.externalId
      ? or(
          eq(visitors.id, visitor.id),
          and(eq(visitors.identityVerified, true), eq(visitors.externalId, visitor.externalId))
        )
      : eq(visitors.id, visitor.id)
  ))
  return rows.map(row => row.id)
}

export async function isVisitorMessagingBlocked(
  visitor: VisitorIdentity,
  db: ReadableDatabase = useDb()
): Promise<boolean> {
  const visitorIds = await linkedVisitorIds(db, visitor)
  if (!visitorIds.length) return false
  const block = await db.query.visitorBlocks.findFirst({
    where: and(
      eq(visitorBlocks.workspaceId, visitor.workspaceId),
      inArray(visitorBlocks.visitorRef, visitorIds),
      isNull(visitorBlocks.unblockedAt)
    ),
    columns: { id: true }
  })
  return !!block
}

export async function assertVisitorCanMessage(
  visitor: VisitorIdentity,
  db: ReadableDatabase = useDb()
): Promise<void> {
  if (!await isVisitorMessagingBlocked(visitor, db)) return
  throw createError({
    statusCode: 403,
    statusMessage: 'Messaging is unavailable',
    data: { code: MESSAGING_UNAVAILABLE_CODE }
  })
}
