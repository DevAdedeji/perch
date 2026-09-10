import { and, articleGroups, articles, asc, desc, eq, inArray, or, sql, workspaces, type Database } from '@perch/db'

export const PUBLIC_HELP_SITE_ID_PATTERN = /^ws_[a-f0-9]{10}$/
export const PUBLIC_HELP_ARTICLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PUBLIC_HELP_EXCERPT_SOURCE_LENGTH = 181
export const PUBLIC_HELP_SEARCH_MAX_LENGTH = 80
export const PUBLIC_HELP_SEARCH_RESULT_LIMIT = 50
export const AGENT_HELP_SUGGESTION_LIMIT = 8
const PUBLIC_HELP_INDEX_RESULT_LIMIT = 200

export interface PublishedHelpSitemapEntry {
  siteId: string
  articleId: string
}

export function normalizePublicArticleUrl(value: string | null): string | null {
  if (!value) return null

  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export async function findPublicHelpWorkspaceId(db: Database, siteId: string): Promise<string | null> {
  const workspace = await db.query.workspaces.findFirst({
    columns: { id: true },
    where: eq(workspaces.siteId, siteId)
  })
  return workspace?.id ?? null
}

export async function listPublishedHelpGroups(db: Database, workspaceId: string, search?: string) {
  const groups = await db.query.articleGroups.findMany({
    columns: { id: true, name: true, description: true },
    where: eq(articleGroups.workspaceId, workspaceId),
    orderBy: [asc(articleGroups.sortOrder), asc(articleGroups.createdAt)]
  })
  const matchingGroupIds = search
    ? groups.filter(group => [group.name, group.description ?? '']
        .some(value => value.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
        .map(group => group.id)
    : []
  const searchCondition = search
    ? or(
        sql<boolean>`position(lower(${search}) in lower(${articles.title})) > 0`,
        sql<boolean>`position(lower(${search}) in lower(${articles.body})) > 0`,
        ...(matchingGroupIds.length ? [inArray(articles.groupId, matchingGroupIds)] : [])
      )
    : undefined

  const rows = await db.select({
    id: articles.id,
    groupId: articles.groupId,
    title: articles.title,
    excerpt: sql<string>`left(regexp_replace(btrim(${articles.body}), '\\s+', ' ', 'g'), ${PUBLIC_HELP_EXCERPT_SOURCE_LENGTH})`,
    url: articles.url
  })
    .from(articles)
    .where(and(
      eq(articles.workspaceId, workspaceId),
      eq(articles.status, 'published'),
      searchCondition
    ))
    .orderBy(asc(articles.createdAt))
    .limit(search ? PUBLIC_HELP_SEARCH_RESULT_LIMIT : PUBLIC_HELP_INDEX_RESULT_LIMIT)

  return groups
    .map(group => ({
      ...group,
      articles: rows.filter(article => article.groupId === group.id).map(article => ({
        id: article.id,
        title: article.title,
        excerpt: article.excerpt,
        url: normalizePublicArticleUrl(article.url)
      }))
    }))
    .filter(group => group.articles.length > 0)
}

export async function findPublishedHelpArticle(db: Database, workspaceId: string, articleId: string) {
  const article = await db.query.articles.findFirst({
    columns: { id: true, groupId: true, title: true, body: true, url: true },
    where: and(
      eq(articles.id, articleId),
      eq(articles.workspaceId, workspaceId),
      eq(articles.status, 'published')
    )
  })
  if (!article) return null

  const group = await db.query.articleGroups.findFirst({
    columns: { id: true, name: true },
    where: and(eq(articleGroups.id, article.groupId), eq(articleGroups.workspaceId, workspaceId))
  })
  if (!group) return null

  return {
    id: article.id,
    title: article.title,
    body: article.body,
    url: normalizePublicArticleUrl(article.url),
    group
  }
}

export async function listPublishedHelpSuggestions(db: Database, workspaceId: string, search?: string) {
  const searchCondition = search
    ? or(
        sql<boolean>`position(lower(${search}) in lower(${articles.title})) > 0`,
        sql<boolean>`position(lower(${search}) in lower(${articles.body})) > 0`,
        sql<boolean>`position(lower(${search}) in lower(${articleGroups.name})) > 0`
      )
    : undefined

  return db.select({
    id: articles.id,
    title: articles.title,
    excerpt: sql<string>`left(regexp_replace(btrim(${articles.body}), '\\s+', ' ', 'g'), ${PUBLIC_HELP_EXCERPT_SOURCE_LENGTH})`,
    url: articles.url,
    group: articleGroups.name
  })
    .from(articles)
    .innerJoin(articleGroups, and(
      eq(articleGroups.id, articles.groupId),
      eq(articleGroups.workspaceId, workspaceId)
    ))
    .where(and(
      eq(articles.workspaceId, workspaceId),
      eq(articles.status, 'published'),
      searchCondition
    ))
    .orderBy(
      ...(search
        ? [
            sql`case when position(lower(${search}) in lower(${articles.title})) > 0 then 0 else 1 end`,
            asc(articles.title)
          ]
        : [desc(articles.updatedAt)])
    )
    .limit(AGENT_HELP_SUGGESTION_LIMIT)
}

export async function listPublishedHelpSitemapEntries(db: Database, limit: number): Promise<PublishedHelpSitemapEntry[]> {
  return db.select({ siteId: workspaces.siteId, articleId: articles.id })
    .from(articles)
    .innerJoin(workspaces, eq(workspaces.id, articles.workspaceId))
    .where(eq(articles.status, 'published'))
    .orderBy(asc(workspaces.siteId), asc(articles.createdAt))
    .limit(limit)
}

export function publicHelpSitemapPaths(entries: PublishedHelpSitemapEntry[], maxPaths: number): string[] {
  const paths: string[] = []
  const sites = new Set<string>()

  for (const entry of entries) {
    if (!PUBLIC_HELP_SITE_ID_PATTERN.test(entry.siteId) || !PUBLIC_HELP_ARTICLE_ID_PATTERN.test(entry.articleId)) continue

    const needed = sites.has(entry.siteId) ? 1 : 2
    if (paths.length + needed > maxPaths) break
    if (!sites.has(entry.siteId)) {
      sites.add(entry.siteId)
      paths.push(`/help/${entry.siteId}`)
    }
    paths.push(`/help/${entry.siteId}/${entry.articleId}`)
  }

  return paths
}
