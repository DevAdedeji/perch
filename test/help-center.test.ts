import { describe, expect, it } from 'vitest'
import { helpArticleExcerpt } from '../app/utils/help-center'
import { normalizePublicArticleUrl, publicHelpSitemapPaths } from '../server/utils/help-center'

describe('public help center', () => {
  it('creates short, whitespace-normalized excerpts', () => {
    expect(helpArticleExcerpt(' First\n\nsecond ')).toBe('First second')
    expect(helpArticleExcerpt('One two three', 8)).toBe('One two…')
  })

  it('allows only safe public HTTP(S) article links', () => {
    expect(normalizePublicArticleUrl('https://docs.example.com/help')).toBe('https://docs.example.com/help')
    expect(normalizePublicArticleUrl('http://docs.example.com/help')).toBe('http://docs.example.com/help')
    expect(normalizePublicArticleUrl('javascript:alert(1)')).toBeNull()
    expect(normalizePublicArticleUrl('https://user:secret@example.com/help')).toBeNull()
    expect(normalizePublicArticleUrl('not a url')).toBeNull()
    expect(normalizePublicArticleUrl(null)).toBeNull()
  })

  it('discovers valid help centers and articles without exceeding the sitemap capacity', () => {
    const paths = publicHelpSitemapPaths([
      { siteId: 'ws_18c6715c14', articleId: '550e8400-e29b-41d4-a716-446655440000' },
      { siteId: 'ws_18c6715c14', articleId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8' },
      { siteId: 'invalid', articleId: '550e8400-e29b-41d4-a716-446655440000' }
    ], 3)

    expect(paths).toEqual([
      '/help/ws_18c6715c14',
      '/help/ws_18c6715c14/550e8400-e29b-41d4-a716-446655440000',
      '/help/ws_18c6715c14/6ba7b810-9dad-41d1-80b4-00c04fd430c8'
    ])
  })
})
