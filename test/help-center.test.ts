import { describe, expect, it } from 'vitest'
import { filterHelpGroups, helpArticleExcerpt } from '../app/utils/help-center'
import { normalizePublicArticleUrl } from '../server/utils/help-center'

const groups = [{
  id: 'group-1',
  name: 'Getting started',
  description: 'Account setup',
  articles: [
    { id: 'article-1', title: 'Invite teammates', body: 'Open Team settings and send an invite.', url: null },
    { id: 'article-2', title: 'Contact billing', body: 'Email the accounts team.', url: 'https://example.com/billing' }
  ]
}]

describe('public help center', () => {
  it('searches titles, article bodies, group names and descriptions', () => {
    expect(filterHelpGroups(groups, 'invite')[0]?.articles.map(article => article.id)).toEqual(['article-1'])
    expect(filterHelpGroups(groups, 'accounts')[0]?.articles.map(article => article.id)).toEqual(['article-2'])
    expect(filterHelpGroups(groups, 'getting started')[0]?.articles).toHaveLength(2)
    expect(filterHelpGroups(groups, 'missing')).toEqual([])
  })

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
})
