import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public help API boundary', () => {
  const source = readFileSync(new URL('../server/api/widget/articles.get.ts', import.meta.url), 'utf8')

  it('queries only articles explicitly marked as published', () => {
    expect(source).toContain(`eq(articles.status, 'published')`)
  })

  it('scopes article and group reads to the workspace resolved by site id', () => {
    expect(source).toContain('eq(articleGroups.workspaceId, workspace.id)')
    expect(source).toContain('eq(articles.workspaceId, workspace.id)')
  })

  it('normalizes external URLs before returning them to public pages', () => {
    expect(source).toContain('url: normalizePublicArticleUrl(a.url)')
  })
})
