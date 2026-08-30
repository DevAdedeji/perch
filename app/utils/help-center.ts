export interface PublicHelpArticle {
  id: string
  title: string
  body: string
  url: string | null
}

export interface PublicHelpGroup {
  id: string
  name: string
  description: string | null
  articles: PublicHelpArticle[]
}

export function helpArticleExcerpt(body: string, maxLength = 180): string {
  const compact = body.trim().replace(/\s+/g, ' ')
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function filterHelpGroups(groups: PublicHelpGroup[], query: string): PublicHelpGroup[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return groups

  return groups
    .map(group => ({
      ...group,
      articles: group.articles.filter(article =>
        [article.title, article.body, group.name, group.description ?? '']
          .some(value => value.toLocaleLowerCase().includes(needle))
      )
    }))
    .filter(group => group.articles.length > 0)
}
