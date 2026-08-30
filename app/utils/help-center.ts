export interface PublicHelpArticle {
  id: string
  title: string
  excerpt: string
  url: string | null
}

export interface PublicHelpArticleDetail {
  id: string
  title: string
  body: string
  url: string | null
  group: { id: string, name: string }
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
