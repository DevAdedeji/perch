import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
  visitorBlocks,
  visitors,
  type Database,
  type Visitor
} from '@perch/db'

export const MESSAGING_UNAVAILABLE_CODE = 'MESSAGING_UNAVAILABLE'

type VisitorIdentity = Pick<Visitor, 'id' | 'workspaceId' | 'externalId' | 'identityVerified'>
type ReadableDatabase = Pick<Database, 'select' | 'query'>
type ExecutableDatabase = Pick<Database, 'execute'>

/** One moderation lookup for an eligible roster batch, including verified sibling sessions. */
export async function blockedVisitorIds(db: ReadableDatabase, workspaceId: string, candidates: VisitorIdentity[]): Promise<Set<string>> {
  if (!candidates.length) return new Set()
  const externalIds = [...new Set(candidates.filter(visitor => visitor.identityVerified && visitor.externalId).map(visitor => visitor.externalId!))]
  const blocked = await db.select({ id: visitors.id, externalId: visitors.externalId, identityVerified: visitors.identityVerified })
    .from(visitorBlocks).innerJoin(visitors, eq(visitorBlocks.visitorRef, visitors.id)).where(and(
      eq(visitorBlocks.workspaceId, workspaceId), eq(visitors.workspaceId, workspaceId), isNull(visitorBlocks.unblockedAt),
      or(inArray(visitors.id, candidates.map(visitor => visitor.id)), externalIds.length
        ? and(eq(visitors.identityVerified, true), inArray(visitors.externalId, externalIds))
        : undefined)
    ))
  const direct = new Set(blocked.map(visitor => visitor.id))
  const identities = new Set(blocked.filter(visitor => visitor.identityVerified).map(visitor => visitor.externalId))
  return new Set(candidates.filter(visitor => direct.has(visitor.id)
    || (visitor.identityVerified && !!visitor.externalId && identities.has(visitor.externalId))).map(visitor => visitor.id))
}

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

/** Different browser rows for one verified user need one transaction lock before moderation decisions. */
export async function lockVisitorModerationIdentity(
  db: ExecutableDatabase,
  visitor: VisitorIdentity
): Promise<void> {
  const identity = visitor.identityVerified && visitor.externalId
    ? `verified:${visitor.externalId}`
    : `session:${visitor.id}`
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${visitor.workspaceId}), hashtext(${identity}))`)
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
