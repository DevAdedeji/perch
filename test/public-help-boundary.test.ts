import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public help API boundary', () => {
  const listSource = readFileSync(new URL('../server/api/widget/articles.get.ts', import.meta.url), 'utf8')
  const detailSource = readFileSync(new URL('../server/api/widget/articles/[articleId].get.ts', import.meta.url), 'utf8')
  const serviceSource = readFileSync(new URL('../server/utils/help-center.ts', import.meta.url), 'utf8')
  const sitemapSource = readFileSync(new URL('../server/routes/sitemap.xml.ts', import.meta.url), 'utf8')
  const indexPageSource = readFileSync(new URL('../app/pages/help/[siteId]/index.vue', import.meta.url), 'utf8')

  it('keeps article bodies out of the public index response', () => {
    expect(serviceSource).toContain('excerpt: sql<string>')
    expect(serviceSource).not.toContain('body: articles.body')
    expect(listSource).toContain('listPublishedHelpGroups(db, workspaceId, search)')
  })

  it('searches full published content while keeping public responses bounded and lightweight', () => {
    expect(serviceSource).toContain('position(lower(${search}) in lower(${articles.body})) > 0')
    expect(serviceSource).toContain('.limit(search ? PUBLIC_HELP_SEARCH_RESULT_LIMIT : PUBLIC_HELP_INDEX_RESULT_LIMIT)')
    expect(listSource).toContain('q: z.string().trim().max(PUBLIC_HELP_SEARCH_MAX_LENGTH).optional()')
    expect(listSource).toContain('assertRateLimit(\'widget-article-search:site-ip\'')
    expect(serviceSource).not.toContain('body: articles.body')
  })

  it('requires the article detail to be published and scoped to the resolved workspace', () => {
    expect(serviceSource).toContain('eq(articles.id, articleId)')
    expect(serviceSource).toContain('eq(articles.workspaceId, workspaceId)')
    expect(serviceSource).toContain(`eq(articles.status, 'published')`)
    expect(detailSource).toContain('findPublicHelpWorkspaceId(db, query.data.site_id)')
    expect(detailSource).toContain('findPublishedHelpArticle(db, workspaceId, params.data.articleId)')
  })

  it('normalizes external URLs before returning them to public pages', () => {
    expect(serviceSource).toContain('url: normalizePublicArticleUrl(article.url)')
  })

  it('returns not found for malformed public identifiers', () => {
    expect(listSource).toContain('statusCode: 404, statusMessage: \'Help center not found\'')
    expect(detailSource).toContain('statusCode: 404, statusMessage: \'Article not found\'')
  })

  it('preserves rate-limit status during help-center SSR', () => {
    expect(indexPageSource).toContain('error.value.statusCode === 429 ? 429 : 503')
  })

  it('adds only published help content to the dynamic sitemap', () => {
    expect(serviceSource).toContain(`.where(eq(articles.status, 'published'))`)
    expect(sitemapSource).toContain('publicHelpSitemapPaths(entries, capacity)')
  })
})
